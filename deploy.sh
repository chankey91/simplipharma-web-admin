#!/bin/bash

################################################################################
# SimpliPharma Admin Panel - Deployment Script
# 
# This script handles manual deployment without Jenkins
# Use this for initial setup or emergency deployments
#
# Usage: ./deploy.sh
################################################################################

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
APP_NAME="simplipharma-admin"
DEPLOY_PATH="/var/www/${APP_NAME}"
NGINX_PORT="8085"
REPO_URL="https://github.com/chankey91/simplipharma-web-admin.git"

# Function to print colored messages
print_message() {
    echo -e "${2}${1}${NC}"
}

print_header() {
    echo ""
    echo "=========================================="
    echo "$1"
    echo "=========================================="
    echo ""
}

# Check if running as correct user
if [ "$EUID" -eq 0 ]; then 
    print_message "❌ Please do not run this script as root" "$RED"
    print_message "Run as regular user with sudo privileges" "$YELLOW"
    exit 1
fi

print_header "SimpliPharma Admin Panel - Deployment Script"

# Step 1: Check prerequisites
print_message "📋 Checking prerequisites..." "$BLUE"

# Check Node.js
if ! command -v node &> /dev/null; then
    print_message "❌ Node.js is not installed" "$RED"
    print_message "Please install Node.js 18+ first" "$YELLOW"
    exit 1
fi

NODE_VERSION=$(node -v)
print_message "✅ Node.js version: $NODE_VERSION" "$GREEN"

# Check npm
if ! command -v npm &> /dev/null; then
    print_message "❌ npm is not installed" "$RED"
    exit 1
fi

NPM_VERSION=$(npm -v)
print_message "✅ npm version: $NPM_VERSION" "$GREEN"

# Check Nginx
if ! command -v nginx &> /dev/null; then
    print_message "❌ Nginx is not installed" "$RED"
    print_message "Install with: sudo apt-get install nginx" "$YELLOW"
    exit 1
fi

print_message "✅ Nginx is installed" "$GREEN"

# Step 2: Check for .env file
print_header "Checking Environment Configuration"

if [ ! -f .env ]; then
    print_message "❌ .env file not found" "$RED"
    print_message "Creating .env template..." "$YELLOW"
    
    cat > .env << 'EOF'
# Firebase Configuration
VITE_FIREBASE_API_KEY=your-api-key-here
VITE_FIREBASE_AUTH_DOMAIN=simplipharma.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=simplipharma
VITE_FIREBASE_STORAGE_BUCKET=simplipharma.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=your-sender-id
VITE_FIREBASE_APP_ID=your-app-id

# Application Configuration
VITE_APP_NAME="SimpliPharma Admin Panel"
VITE_APP_VERSION=1.0.0
EOF
    
    print_message "⚠️  Please edit .env file with your Firebase credentials" "$YELLOW"
    print_message "After editing, run this script again" "$YELLOW"
    exit 0
fi

print_message "✅ .env file found" "$GREEN"

# Step 3: Install dependencies
print_header "Installing Dependencies"
print_message "📦 Running npm install..." "$BLUE"
npm install

if [ $? -ne 0 ]; then
    print_message "❌ npm install failed" "$RED"
    exit 1
fi

print_message "✅ Dependencies installed successfully" "$GREEN"

# Step 4: Build application
print_header "Building Application"
print_message "🔨 Building production bundle..." "$BLUE"
npm run build

if [ $? -ne 0 ]; then
    print_message "❌ Build failed" "$RED"
    exit 1
fi

if [ ! -d "dist" ]; then
    print_message "❌ Build directory (dist) not found" "$RED"
    exit 1
fi

print_message "✅ Build completed successfully" "$GREEN"

# Step 5: Create deployment directory
print_header "Creating Deployment Directory"
print_message "📁 Creating ${DEPLOY_PATH}..." "$BLUE"

sudo mkdir -p ${DEPLOY_PATH}
sudo chown -R $USER:www-data ${DEPLOY_PATH}

print_message "✅ Deployment directory created" "$GREEN"

# Step 6: Backup existing deployment
if [ -d "${DEPLOY_PATH}/current" ]; then
    print_message "💾 Backing up current deployment..." "$BLUE"
    BACKUP_NAME="backup-$(date +%Y%m%d-%H%M%S)"
    sudo mv ${DEPLOY_PATH}/current ${DEPLOY_PATH}/${BACKUP_NAME}
    print_message "✅ Backup created: ${BACKUP_NAME}" "$GREEN"
fi

# Step 7: Deploy new build
print_header "Deploying Application"
print_message "🚀 Deploying to ${DEPLOY_PATH}/current..." "$BLUE"

sudo mkdir -p ${DEPLOY_PATH}/current
sudo cp -r dist/* ${DEPLOY_PATH}/current/

# Set proper permissions
sudo chown -R www-data:www-data ${DEPLOY_PATH}/current
sudo chmod -R 755 ${DEPLOY_PATH}/current

print_message "✅ Files deployed successfully" "$GREEN"

# Step 8: Configure Nginx
print_header "Configuring Nginx"

if [ ! -f /etc/nginx/sites-available/simplipharma-admin ]; then
    print_message "📝 Creating Nginx configuration..." "$BLUE"
    
    sudo tee /etc/nginx/sites-available/simplipharma-admin > /dev/null << 'EOFNGINX'
server {
    listen 8085;
    server_name 103.230.227.5;
    
    root /var/www/simplipharma-admin/current;
    index index.html;
    
    access_log /var/log/nginx/simplipharma-admin-access.log;
    error_log /var/log/nginx/simplipharma-admin-error.log;
    
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/xml text/javascript application/x-javascript application/xml+rss application/javascript application/json;
    
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    
    location ~* \.(jpg|jpeg|png|gif|ico|css|js|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
    
    location / {
        try_files $uri $uri/ /index.html;
    }
    
    location /health {
        access_log off;
        return 200 "healthy\n";
        add_header Content-Type text/plain;
    }
}
EOFNGINX
    
    # Enable site
    sudo ln -sf /etc/nginx/sites-available/simplipharma-admin /etc/nginx/sites-enabled/
    print_message "✅ Nginx configuration created" "$GREEN"
else
    print_message "✅ Nginx configuration already exists" "$GREEN"
fi

# Test Nginx configuration
print_message "🔍 Testing Nginx configuration..." "$BLUE"
sudo nginx -t

if [ $? -ne 0 ]; then
    print_message "❌ Nginx configuration test failed" "$RED"
    exit 1
fi

# Reload Nginx
print_message "🔄 Reloading Nginx..." "$BLUE"
sudo systemctl reload nginx

if [ $? -ne 0 ]; then
    print_message "❌ Failed to reload Nginx" "$RED"
    exit 1
fi

print_message "✅ Nginx reloaded successfully" "$GREEN"

# Step 9: Verify deployment
print_header "Verifying Deployment"

if [ ! -f "${DEPLOY_PATH}/current/index.html" ]; then
    print_message "❌ index.html not found in deployment directory" "$RED"
    exit 1
fi

print_message "✅ Files verified" "$GREEN"

# Test HTTP endpoint
print_message "🔍 Testing HTTP endpoint..." "$BLUE"
sleep 2

if curl -sf http://localhost:${NGINX_PORT}/health > /dev/null; then
    print_message "✅ Health check passed" "$GREEN"
else
    print_message "⚠️  Health check failed (may need time to start)" "$YELLOW"
fi

# Step 10: Cleanup old backups
print_message "🧹 Cleaning up old backups (keeping last 3)..." "$BLUE"
cd ${DEPLOY_PATH}
ls -t | grep backup | tail -n +4 | xargs -r sudo rm -rf
print_message "✅ Cleanup completed" "$GREEN"

# Final success message
print_header "🎉 Deployment Completed Successfully!"
echo ""
print_message "Application URL: http://103.230.227.5:${NGINX_PORT}" "$GREEN"
print_message "Health Check: http://103.230.227.5:${NGINX_PORT}/health" "$GREEN"
echo ""
print_message "Logs:" "$BLUE"
print_message "  Access: /var/log/nginx/simplipharma-admin-access.log" "$BLUE"
print_message "  Error:  /var/log/nginx/simplipharma-admin-error.log" "$BLUE"
echo ""
print_message "To rollback: sudo mv ${DEPLOY_PATH}/backup-* ${DEPLOY_PATH}/current" "$YELLOW"
echo ""

