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
import hmac
import json
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
    # Use constant-time comparison to prevent timing attacks
    if not hmac.compare_digest(token, expected_secret):
        raise HTTPException(status_code=403, detail="Invalid API secret")

# Image for web endpoints (requires FastAPI and Pydantic)
endpoint_image = modal.Image.debian_slim(python_version="3.11").pip_install("fastapi[standard]", "pydantic")

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
    print(f"[1/10] Starting sandbox creation for repo: {repo}")

    # Create sandbox with tunnel on port 4096
    # 10 minute timeout - Cloudflare DO will auto-pause before this
    # Using 1 core + 2GB RAM (sufficient for OpenCode server + git operations)
    print("[2/10] Creating Modal sandbox with encrypted port 4096...")
    sb = modal.Sandbox.create(
        image=sandbox_image,
        app=app,
        timeout=600,  # 10 minute timeout
        encrypted_ports=[4096],
        cpu=1.0,
        memory=2048,  # 2GB in MB
    )
    print(f"[2/10] Sandbox created with ID: {sb.object_id}")

    # Configure git credentials securely (PAT not visible in process listing)
    # Store credentials in a file with restricted permissions
    print(f"[3/10] Configuring git credentials...")
    credential_url = f"https://x-access-token:{pat}@github.com"
    sb.exec(
        "sh", "-c",
        f"umask 077 && echo '{credential_url}' > /root/.git-credentials"
    ).wait()
    sb.exec("git", "config", "--global", "credential.helper", "store --file=/root/.git-credentials").wait()

    # Clone the repository (PAT is read from credential store, not command line)
    print(f"[3/10] Cloning repository...")
    clone_result = sb.exec("git", "clone", f"https://github.com/{repo}.git", "/workspace")
    clone_result.wait()

    if clone_result.returncode != 0:
        error = clone_result.stderr.read()
        print(f"[3/10] ERROR: Clone failed: {error}")
        sb.terminate()
        raise Exception(f"Failed to clone repository: {error}")
    print("[3/10] Repository cloned successfully")

    # Fetch the authenticated user's identity directly from GitHub API using curl
    # This avoids the gh CLI which requires additional scopes like read:org
    print("[4/10] Fetching GitHub user identity...")
    user_result = sb.exec(
        "curl", "-s", "-H", f"Authorization: Bearer {pat}",
        "-H", "Accept: application/vnd.github+json",
        "https://api.github.com/user"
    )
    user_result.wait()
    user_output = user_result.stdout.read()
    if isinstance(user_output, bytes):
        user_output = user_output.decode("utf-8")

    # Parse JSON response
    try:
        user_data = json.loads(user_output)
        github_username = user_data.get("login", "github-user")
        github_email = user_data.get("email") or ""
        github_name = user_data.get("name") or github_username
        print(f"[4/10] API response: login={github_username}, name={github_name}, email={github_email or 'private'}")
    except json.JSONDecodeError as e:
        print(f"[4/10] Warning: Failed to parse GitHub API response: {e}")
        print(f"[4/10] Response was: {user_output[:200]}")
        github_username = "github-user"
        github_email = ""
        github_name = "github-user"

    # If email is private/empty, use the GitHub noreply email
    if not github_email:
        github_email = f"{github_username}@users.noreply.github.com"

    print(f"[4/10] GitHub user: {github_name} <{github_email}>")

    # Configure git with the user's actual identity (both global and local)
    print("[5/10] Configuring git...")
    # Set global config (used by any git command)
    sb.exec("git", "config", "--global", "user.email", github_email).wait()
    sb.exec("git", "config", "--global", "user.name", github_name).wait()
    # Also set local config for this repo
    sb.exec("git", "config", "user.email", github_email, workdir="/workspace").wait()
    sb.exec("git", "config", "user.name", github_name, workdir="/workspace").wait()

    # Verify the config was set correctly
    verify_result = sb.exec("git", "config", "--get", "user.name", workdir="/workspace")
    verify_result.wait()
    verify_output = verify_result.stdout.read()
    if isinstance(verify_output, bytes):
        verify_output = verify_output.decode("utf-8")
    print(f"[5/10] Verified git user.name: {verify_output.strip()}")

    # Set origin URL without PAT - credentials are handled by git credential helper
    sb.exec(
        "git", "remote", "set-url", "origin",
        f"https://github.com/{repo}.git",
        workdir="/workspace"
    ).wait()

    # Create and checkout a new branch for this session
    branch_name = f"opencode/session-{int(time.time())}"
    print(f"[6/10] Creating branch: {branch_name}")
    checkout_result = sb.exec("git", "checkout", "-b", branch_name, workdir="/workspace")
    checkout_result.wait()

    if checkout_result.returncode != 0:
        error = checkout_result.stderr.read()
        print(f"[6/10] Warning: Failed to create branch {branch_name}: {error}")
        # Continue anyway - agent can still work on default branch

    # Create OpenCode configuration file with server settings
    # Let OpenCode use its default model
    print("[8/10] Creating opencode.json configuration...")
    opencode_config = '''{
  "server": {
    "port": 4096,
    "hostname": "0.0.0.0"
  }
}'''
    config_result = sb.exec(
        "sh", "-c",
        f"echo '{opencode_config}' > /workspace/opencode.json && cat /workspace/opencode.json"
    )
    config_result.wait()
    print(f"[8/10] Config file created: {config_result.stdout.read()[:100]}...")

    # Start OpenCode server in the background
    # Write GH_TOKEN to a secure environment file (not visible in ps aux)
    print("[9/10] Starting OpenCode server...")
    sb.exec(
        "sh", "-c",
        f"umask 077 && echo 'export GH_TOKEN=\"{pat}\"' > /root/.opencode-env"
    ).wait()
    sb.exec(
        "sh", "-c",
        "cd /workspace && source /root/.opencode-env && opencode serve --port 4096 --hostname 0.0.0.0 > /tmp/opencode.log 2>&1 &"
    ).wait()

    # Give the server time to start
    print("[9/10] Waiting for server to start (5 seconds)...")
    await asyncio.sleep(5)

    # Check if OpenCode is running and get logs
    print("[9/10] Checking OpenCode status...")
    ps_result = sb.exec("sh", "-c", "ps aux | grep opencode || echo 'No opencode process found'")
    ps_result.wait()
    ps_output = ps_result.stdout.read().strip()
    print(f"[9/10] Processes: {ps_output}")

    log_result = sb.exec("sh", "-c", "cat /tmp/opencode.log 2>/dev/null || echo 'No log file yet'")
    log_result.wait()
    log_output = log_result.stdout.read().strip()
    print(f"[9/10] OpenCode log: {log_output[:500] if log_output else 'empty'}")

    # Test health endpoint locally
    print("[9/10] Testing health endpoint locally...")
    health_result = sb.exec("curl", "-s", "-o", "/dev/null", "-w", "%{http_code}", "http://localhost:4096/global/health")
    health_result.wait()
    health_code = health_result.stdout.read().strip()
    print(f"[9/10] Health check response code: {health_code}")

    # Test session creation locally
    print("[9/10] Testing session creation locally...")
    session_result = sb.exec(
        "curl", "-s", "-X", "POST",
        "-H", "Content-Type: application/json",
        "-d", '{"title": "test-session"}',
        "http://localhost:4096/session"
    )
    session_result.wait()
    session_output = session_result.stdout.read().strip()
    session_error = session_result.stderr.read().strip()
    print(f"[9/10] Local session test result: {session_output[:200] if session_output else 'empty'}")
    if session_error:
        print(f"[9/10] Local session test error: {session_error}")

    # Get tunnel URL
    print("[10/10] Getting tunnel URL...")
    tunnels = sb.tunnels()
    tunnel_url = tunnels[4096].url
    print(f"[10/10] Tunnel URL: {tunnel_url}")
    print(f"[10/10] Sandbox creation complete!")

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
        dict with snapshot_id for later resume, or error if snapshot failed
    """
    print(f"[pause] Pausing sandbox: {sandbox_id}")
    sb = modal.Sandbox.from_id(sandbox_id)

    # Capture filesystem snapshot - if this fails, don't terminate
    try:
        snapshot = sb.snapshot_filesystem()
        snapshot_id = snapshot.object_id
        print(f"[pause] Snapshot created: {snapshot_id}")
    except Exception as e:
        print(f"[pause] ERROR: Snapshot failed: {e}")
        # Do NOT terminate - let session continue running so user doesn't lose work
        return {"error": f"Snapshot failed: {str(e)}"}

    # Only terminate after successful snapshot
    try:
        sb.terminate()
        print("[pause] Sandbox terminated")
    except Exception as e:
        print(f"[pause] Warning: Terminate failed (snapshot still saved): {e}")
        # Continue anyway - snapshot is saved, sandbox may have already timed out

    return {
        "snapshot_id": snapshot_id,
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
    print(f"[resume] Starting resume from snapshot: {snapshot_id}")

    # Restore image from snapshot
    image = modal.Image.from_id(snapshot_id)

    # Create new sandbox with restored state
    # 10 minute timeout - Cloudflare DO will auto-pause before this
    # Using 1 core + 2GB RAM (same as create_sandbox)
    sb = modal.Sandbox.create(
        image=image,
        app=app,
        timeout=600,  # 10 minute timeout
        encrypted_ports=[4096],
        cpu=1.0,
        memory=2048,  # 2GB in MB
    )
    print(f"[resume] Sandbox created with ID: {sb.object_id}")

    # Start OpenCode server again using the saved environment
    # Source the env file that was created during initial sandbox creation
    print("[resume] Starting OpenCode server...")
    sb.exec(
        "sh", "-c",
        "cd /workspace && source /root/.opencode-env 2>/dev/null; opencode serve --port 4096 --hostname 0.0.0.0 > /tmp/opencode.log 2>&1 &"
    ).wait()

    # Get tunnel URL
    tunnels = sb.tunnels()
    tunnel_url = tunnels[4096].url
    print(f"[resume] Tunnel URL: {tunnel_url}")

    # Give the server initial time to start
    print("[resume] Waiting for server to start (3 seconds)...")
    await asyncio.sleep(3)

    # Verify OpenCode is running with health checks (same as create_sandbox)
    print("[resume] Verifying OpenCode server is ready...")
    for i in range(30):  # 30 attempts, 2 sec each = 60 sec max
        health_result = sb.exec(
            "curl", "-s", "-o", "/dev/null", "-w", "%{http_code}",
            "http://localhost:4096/global/health"
        )
        health_result.wait()
        health_code = health_result.stdout.read()
        if isinstance(health_code, bytes):
            health_code = health_code.decode("utf-8").strip()

        if health_code == "200":
            print(f"[resume] OpenCode server is ready (attempt {i + 1})")
            break

        print(f"[resume] Health check returned {health_code}, retrying... (attempt {i + 1}/30)")
        await asyncio.sleep(2)
    else:
        # Log output for debugging
        log_result = sb.exec("sh", "-c", "cat /tmp/opencode.log 2>/dev/null || echo 'No log file'")
        log_result.wait()
        log_output = log_result.stdout.read()
        print(f"[resume] OpenCode log: {log_output[:500] if log_output else 'empty'}")
        raise Exception("OpenCode server failed to start after resume (30 attempts)")

    print("[resume] Resume complete!")
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
    print(f"[terminate] Terminating sandbox: {sandbox_id}")
    try:
        sb = modal.Sandbox.from_id(sandbox_id)
        sb.terminate()
        print("[terminate] Sandbox terminated successfully")
        return {"success": True}
    except Exception as e:
        print(f"[terminate] ERROR: Failed to terminate sandbox: {e}")
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

        # Get OpenCode log file
        log_result = sb.exec("cat", "/tmp/opencode.log")
        log_result.wait()
        opencode_log = log_result.stdout.read()

        # Try creating a session locally to test
        session_test = sb.exec(
            "curl", "-s", "-X", "POST",
            "-H", "Content-Type: application/json",
            "-d", '{"title": "test"}',
            "http://localhost:4096/session"
        )
        session_test.wait()
        session_result = session_test.stdout.read()
        session_error = session_test.stderr.read()

        return {
            "processes": processes,
            "health_check": health_output,
            "health_error": health_error,
            "opencode_log": opencode_log,
            "session_test_result": session_result,
            "session_test_error": session_error,
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


# Pydantic models for request bodies - defined here so they're available at import time
# The actual imports happen inside the endpoint functions since they run with endpoint_image
class CreateSandboxRequest:
    """Request body for creating a sandbox."""
    repo: str
    pat: str


# HTTP endpoint for Cloudflare Worker to call
@app.function(image=endpoint_image, secrets=[api_secret])
@modal.fastapi_endpoint(method="POST")
async def api_create_sandbox(body: dict) -> dict:
    """HTTP endpoint to create a sandbox."""
    print(f"[api_create_sandbox] Received request body: {body}")

    repo = body.get("repo") if isinstance(body, dict) else None
    pat = body.get("pat") if isinstance(body, dict) else None

    print(f"[api_create_sandbox] Parsed: repo={repo}, pat={'[SET]' if pat else 'None'}")

    if not repo or not pat:
        print(f"[api_create_sandbox] Missing parameters")
        return {"error": "Missing repo or pat parameter"}

    print(f"[api_create_sandbox] Calling create_sandbox for repo: {repo}")
    try:
        result = await create_sandbox.remote.aio(repo=repo, pat=pat)
        print(f"[api_create_sandbox] create_sandbox returned: {result}")
        return result
    except Exception as e:
        print(f"[api_create_sandbox] create_sandbox failed: {e}")
        return {"error": str(e)}


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
