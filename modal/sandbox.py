"""
Modal Sandbox for Background Coding Agent

This module provides isolated execution environments running OpenCode server.
Each sandbox:
1. Clones a repository using a provided GitHub PAT
2. Starts OpenCode server on port 4096
3. Exposes a tunnel for external HTTP access
4. Supports pause/resume via filesystem snapshots
"""

from __future__ import annotations

import asyncio
import os
import time
import modal
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from fastapi import Request

app = modal.App("coding-agent-sandbox")

# Secret for authenticating API requests from Cloudflare
# Set via: modal secret create modal-api-secret MODAL_API_SECRET=your-secret-here
api_secret = modal.Secret.from_name("modal-api-secret")


def verify_auth(request) -> None:
    """Verify the Authorization header matches the API secret.

    Note: FastAPI Request type hint removed to avoid import at module level.
    Import happens inside endpoint functions that use endpoint_image.
    """
    from fastapi import HTTPException

    auth_header = request.headers.get("Authorization")
    expected_secret = os.environ.get("MODAL_API_SECRET")

    if not expected_secret:
        # If no secret configured, allow requests (development mode)
        return

    if not auth_header:
        raise HTTPException(status_code=401, detail="Missing Authorization header")

    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid Authorization header format")

    token = auth_header[7:]  # Remove "Bearer " prefix
    if token != expected_secret:
        raise HTTPException(status_code=403, detail="Invalid API secret")

# Image for web endpoints (requires FastAPI)
endpoint_image = modal.Image.debian_slim(python_version="3.11").pip_install("fastapi[standard]")

# Base image with git, node, gh CLI, and opencode installed
sandbox_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("git", "curl", "ca-certificates", "gnupg")
    .run_commands(
        # Install Node.js 20 LTS
        "curl -fsSL https://deb.nodesource.com/setup_20.x | bash -",
        "apt-get install -y nodejs",
        # Install GitHub CLI (Modal uses amd64 architecture)
        "curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg",
        "chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg",
        "echo 'deb [arch=amd64 signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main' > /etc/apt/sources.list.d/github-cli.list",
        "apt-get update && apt-get install -y gh",
        # Install opencode-ai globally
        "npm install -g opencode-ai@latest",
    )
)


@app.function()
async def create_sandbox(repo: str, pat: str) -> dict:
    """
    Create a new sandbox with the repository cloned and OpenCode server running.

    Args:
        repo: GitHub repository in format "owner/repo"
        pat: GitHub Personal Access Token for cloning

    Returns:
        dict with sandbox_id and tunnel_url
    """
    # Create sandbox with tunnel on port 4096
    # 10 minute timeout - Cloudflare DO will auto-pause before this
    sb = modal.Sandbox.create(
        image=sandbox_image,
        app=app,
        timeout=600,  # 10 minute timeout
        encrypted_ports=[4096],
    )

    # Clone the repository
    clone_url = f"https://{pat}@github.com/{repo}.git"
    clone_result = sb.exec("git", "clone", clone_url, "/workspace")
    clone_result.wait()

    if clone_result.returncode != 0:
        error = clone_result.stderr.read()
        sb.terminate()
        raise Exception(f"Failed to clone repository: {error}")

    # Authenticate GitHub CLI with the PAT first (needed to fetch user identity)
    sb.exec("sh", "-c", f"echo '{pat}' | gh auth login --with-token").wait()

    # Fetch the authenticated user's identity from GitHub
    user_result = sb.exec("gh", "api", "user", "--jq", ".login")
    user_result.wait()
    github_username = user_result.stdout.read().strip() or "github-user"

    email_result = sb.exec("gh", "api", "user", "--jq", ".email // empty")
    email_result.wait()
    github_email = email_result.stdout.read().strip()

    # If email is private/empty, use the GitHub noreply email
    if not github_email:
        github_email = f"{github_username}@users.noreply.github.com"

    name_result = sb.exec("gh", "api", "user", "--jq", ".name // .login")
    name_result.wait()
    github_name = name_result.stdout.read().strip() or github_username

    print(f"Configuring git as: {github_name} <{github_email}>")

    # Configure git with the user's actual identity
    sb.exec("git", "config", "user.email", github_email, workdir="/workspace").wait()
    sb.exec("git", "config", "user.name", github_name, workdir="/workspace").wait()

    # Configure credential helper to use the PAT for push operations
    sb.exec(
        "git", "remote", "set-url", "origin",
        f"https://{pat}@github.com/{repo}.git",
        workdir="/workspace"
    ).wait()

    # Create and checkout a new branch for this session
    branch_name = f"opencode/session-{int(time.time())}"
    checkout_result = sb.exec("git", "checkout", "-b", branch_name, workdir="/workspace")
    checkout_result.wait()

    if checkout_result.returncode != 0:
        error = checkout_result.stderr.read()
        print(f"Warning: Failed to create branch {branch_name}: {error}")
        # Continue anyway - agent can still work on default branch

    # Also set GH_TOKEN in environment for OpenCode to use
    # Start OpenCode server in the background with GH_TOKEN set
    sb.exec(
        "sh", "-c",
        f"cd /workspace && GH_TOKEN='{pat}' opencode serve --port 4096 --hostname 0.0.0.0 > /tmp/opencode.log 2>&1 &"
    ).wait()

    # Give the server time to start
    await asyncio.sleep(3)

    # Get tunnel URL
    tunnels = sb.tunnels()
    tunnel_url = tunnels[4096].url

    return {
        "sandbox_id": sb.object_id,
        "tunnel_url": tunnel_url,
        "branch_name": branch_name,
    }


@app.function()
async def pause_sandbox(sandbox_id: str) -> dict:
    """
    Pause a sandbox by capturing a filesystem snapshot.

    Args:
        sandbox_id: The Modal sandbox ID

    Returns:
        dict with snapshot_id for later resume
    """
    sb = modal.Sandbox.from_id(sandbox_id)

    # Capture filesystem snapshot
    snapshot = sb.snapshot_filesystem()

    # Terminate the sandbox to free resources
    sb.terminate()

    return {
        "snapshot_id": snapshot.object_id,
    }


@app.function()
async def resume_sandbox(snapshot_id: str) -> dict:
    """
    Resume a sandbox from a filesystem snapshot.

    Args:
        snapshot_id: The Modal snapshot ID

    Returns:
        dict with new sandbox_id and tunnel_url
    """
    # Restore image from snapshot
    image = modal.Image.from_id(snapshot_id)

    # Create new sandbox with restored state
    # 10 minute timeout - Cloudflare DO will auto-pause before this
    sb = modal.Sandbox.create(
        image=image,
        app=app,
        timeout=600,  # 10 minute timeout
        encrypted_ports=[4096],
    )

    # Start OpenCode server again (don't wait for it)
    sb.exec(
        "opencode",
        "serve",
        "--port", "4096",
        "--hostname", "0.0.0.0",
        workdir="/workspace",
    )
    # Note: Not calling .wait() so it runs in background

    # Give the server a moment to start
    await asyncio.sleep(3)

    # Get new tunnel URL
    tunnels = sb.tunnels()
    tunnel_url = tunnels[4096].url

    return {
        "sandbox_id": sb.object_id,
        "tunnel_url": tunnel_url,
    }


@app.function()
async def terminate_sandbox(sandbox_id: str) -> dict:
    """
    Terminate a sandbox without saving state.

    Args:
        sandbox_id: The Modal sandbox ID

    Returns:
        dict with success status
    """
    try:
        sb = modal.Sandbox.from_id(sandbox_id)
        sb.terminate()
        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}


@app.function()
async def get_sandbox_logs(sandbox_id: str) -> dict:
    """
    Get logs from a sandbox to debug issues.

    Args:
        sandbox_id: The Modal sandbox ID

    Returns:
        dict with stdout and stderr from running processes
    """
    try:
        sb = modal.Sandbox.from_id(sandbox_id)

        # Try to get logs by running a command
        result = sb.exec("ps", "aux")
        result.wait()
        processes = result.stdout.read()

        # Check if opencode is running
        check_port = sb.exec("curl", "-s", "http://localhost:4096/global/health")
        check_port.wait()
        health_output = check_port.stdout.read()
        health_error = check_port.stderr.read()

        return {
            "processes": processes,
            "health_check": health_output,
            "health_error": health_error,
        }
    except Exception as e:
        return {"error": str(e)}


@app.function(image=endpoint_image, secrets=[api_secret])
@modal.fastapi_endpoint(method="POST")
async def api_get_sandbox_logs(request: Request) -> dict:
    """HTTP endpoint to get sandbox logs."""
    verify_auth(request)
    body = await request.json()
    sandbox_id = body.get("sandbox_id")

    if not sandbox_id:
        return {"error": "Missing sandbox_id parameter"}

    return await get_sandbox_logs.remote.aio(sandbox_id=sandbox_id)


@app.function()
async def get_sandbox_status(sandbox_id: str) -> dict:
    """
    Get the status of a sandbox.

    Args:
        sandbox_id: The Modal sandbox ID

    Returns:
        dict with sandbox status information
    """
    try:
        sb = modal.Sandbox.from_id(sandbox_id)
        return {
            "exists": True,
            "sandbox_id": sandbox_id,
        }
    except Exception as e:
        return {
            "exists": False,
            "error": str(e),
        }


# HTTP endpoint for Cloudflare Worker to call
@app.function(image=endpoint_image, secrets=[api_secret])
@modal.fastapi_endpoint(method="POST")
async def api_create_sandbox(request: Request) -> dict:
    """HTTP endpoint to create a sandbox."""
    verify_auth(request)
    body = await request.json()
    repo = body.get("repo")
    pat = body.get("pat")

    if not repo or not pat:
        return {"error": "Missing repo or pat parameter"}

    return await create_sandbox.remote.aio(repo=repo, pat=pat)


@app.function(image=endpoint_image, secrets=[api_secret])
@modal.fastapi_endpoint(method="POST")
async def api_pause_sandbox(request: Request) -> dict:
    """HTTP endpoint to pause a sandbox."""
    verify_auth(request)
    body = await request.json()
    sandbox_id = body.get("sandbox_id")

    if not sandbox_id:
        return {"error": "Missing sandbox_id parameter"}

    return await pause_sandbox.remote.aio(sandbox_id=sandbox_id)


@app.function(image=endpoint_image, secrets=[api_secret])
@modal.fastapi_endpoint(method="POST")
async def api_resume_sandbox(request: Request) -> dict:
    """HTTP endpoint to resume a sandbox."""
    verify_auth(request)
    body = await request.json()
    snapshot_id = body.get("snapshot_id")

    if not snapshot_id:
        return {"error": "Missing snapshot_id parameter"}

    return await resume_sandbox.remote.aio(snapshot_id=snapshot_id)


@app.function(image=endpoint_image, secrets=[api_secret])
@modal.fastapi_endpoint(method="POST")
async def api_terminate_sandbox(request: Request) -> dict:
    """HTTP endpoint to terminate a sandbox."""
    verify_auth(request)
    body = await request.json()
    sandbox_id = body.get("sandbox_id")

    if not sandbox_id:
        return {"error": "Missing sandbox_id parameter"}

    return await terminate_sandbox.remote.aio(sandbox_id=sandbox_id)


# CLI entry point for testing
@app.local_entrypoint()
def main(repo: str, pat: str):
    """Test sandbox creation from command line."""
    print(f"Creating sandbox for {repo}...")
    result = create_sandbox.remote(repo=repo, pat=pat)
    print(f"Sandbox ID: {result['sandbox_id']}")
    print(f"Tunnel URL: {result['tunnel_url']}")
    print(f"\nTest with: curl {result['tunnel_url']}/health")
