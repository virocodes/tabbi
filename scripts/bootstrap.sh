#!/usr/bin/env bash
# Tabbi Development Environment Bootstrap Script
# Run with: ./scripts/bootstrap.sh

set -e

echo "Bootstrapping Tabbi development environment..."
echo ""

# Check prerequisites
check_prereq() {
  if ! command -v "$1" &> /dev/null; then
    echo "Error: $1 is required but not installed."
    echo "Please install $1 and try again."
    exit 1
  fi
}

echo "Checking prerequisites..."
check_prereq node
check_prereq npm
check_prereq python3
check_prereq pip

NODE_VERSION=$(node -v)
echo "  Node.js: $NODE_VERSION"

PYTHON_VERSION=$(python3 --version)
echo "  Python: $PYTHON_VERSION"

echo ""

# Install root dependencies (Convex, Better-Auth, Husky)
echo "Installing root dependencies..."
npm install

# Install web dependencies
echo ""
echo "Installing web dependencies..."
(cd web && npm install)

# Install cloudflare dependencies
echo ""
echo "Installing cloudflare dependencies..."
(cd cloudflare && npm install)

# Install modal dependencies
echo ""
echo "Installing modal dependencies..."
(cd modal && pip install -r requirements.txt)

# Copy env templates if they don't exist
echo ""
echo "Setting up environment files..."

if [ ! -f .env ]; then
  cp .env.example .env
  echo "  Created .env from .env.example"
else
  echo "  .env already exists, skipping"
fi

if [ ! -f web/.env ]; then
  cp web/.env.example web/.env
  echo "  Created web/.env from web/.env.example"
else
  echo "  web/.env already exists, skipping"
fi

if [ ! -f cloudflare/.env ]; then
  if [ -f cloudflare/.env.example ]; then
    cp cloudflare/.env.example cloudflare/.env
    echo "  Created cloudflare/.env from cloudflare/.env.example"
  else
    echo "  cloudflare/.env.example not found, skipping"
  fi
else
  echo "  cloudflare/.env already exists, skipping"
fi

# Initialize Husky (if .husky doesn't exist)
if [ ! -d .husky ]; then
  echo ""
  echo "Initializing Husky git hooks..."
  npx husky install
else
  echo ""
  echo "Husky already initialized, skipping"
fi

echo ""
echo "==========================================="
echo " Bootstrap complete!"
echo "==========================================="
echo ""
echo "Next steps:"
echo "  1. Edit .env with your OPENAI_API_KEY"
echo "  2. Edit web/.env with your Convex URLs"
echo "  3. Run 'npm run dev' to start all services"
echo ""
echo "Available commands:"
echo "  npm run dev           - Start all services (Convex, Cloudflare, Web)"
echo "  npm run typecheck     - Run TypeScript type checking"
echo "  npm run lint          - Run ESLint"
echo "  npm run test          - Run all tests"
echo "  npm run test:e2e      - Run Playwright E2E tests"
echo ""
