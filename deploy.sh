#!/bin/bash

################################################################################
# SimpliPharma Admin Panel - Deployment Script
#
# Manual deployment without Jenkins.
#
# Usage:
#   ./deploy.sh          # prod (default) → port 8085
#   ./deploy.sh prod     # production
#   ./deploy.sh dev      # development → port 8083
################################################################################

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

APP_NAME="simplipharma-admin"
SERVER_HOST="103.230.227.5"
APP_ENV="${1:-prod}"

case "$APP_ENV" in
    dev|development)
        APP_ENV="dev"
        DEPLOY_PATH="/var/www/${APP_NAME}-dev"
        NGINX_PORT="8083"
        NGINX_SITE="${APP_NAME}-dev"
        ;;
    prod|production|main)
        APP_ENV="prod"
        DEPLOY_PATH="/var/www/${APP_NAME}"
        NGINX_PORT="8085"
        NGINX_SITE="${APP_NAME}"
        ;;
    *)
        echo -e "${RED}Unknown environment: ${APP_ENV}${NC}"
        echo "Usage: ./deploy.sh [dev|prod]"
        exit 1
        ;;
esac

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

if [ "$EUID" -eq 0 ]; then
    print_message "Please do not run this script as root" "$RED"
    print_message "Run as a regular user with sudo privileges" "$YELLOW"
    exit 1
fi

print_header "SimpliPharma Admin - Deployment (${APP_ENV})"

print_message "Environment: ${APP_ENV}" "$BLUE"
print_message "Deploy path: ${DEPLOY_PATH}" "$BLUE"
print_message "Nginx port: ${NGINX_PORT}" "$BLUE"

print_message "Checking prerequisites..." "$BLUE"

if ! command -v node &> /dev/null; then
    print_message "Node.js is not installed" "$RED"
    exit 1
fi
print_message "Node.js version: $(node -v)" "$GREEN"

if ! command -v npm &> /dev/null; then
    print_message "npm is not installed" "$RED"
    exit 1
fi
print_message "npm version: $(npm -v)" "$GREEN"

if ! command -v nginx &> /dev/null; then
    print_message "Nginx is not installed" "$RED"
    exit 1
fi
print_message "Nginx is installed" "$GREEN"

print_header "Environment Configuration"

ENV_FILE=".env.${APP_ENV}"
if [ -f "${ENV_FILE}" ]; then
    cp "${ENV_FILE}" .env
    print_message "Using ${ENV_FILE} → .env" "$GREEN"
elif [ -f .env ]; then
    print_message "Using existing .env (no ${ENV_FILE} found)" "$YELLOW"
else
    print_message ".env / ${ENV_FILE} not found" "$RED"
    cat > "${ENV_FILE}" << 'EOF'
VITE_FIREBASE_API_KEY=your-api-key-here
VITE_FIREBASE_AUTH_DOMAIN=simplipharma.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=simplipharma
VITE_FIREBASE_STORAGE_BUCKET=simplipharma.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=your-sender-id
VITE_FIREBASE_APP_ID=your-app-id
VITE_APP_NAME="SimpliPharma Admin Panel"
VITE_APP_VERSION=1.0.0
EOF
    print_message "Created ${ENV_FILE} template — fill Firebase values and run again" "$YELLOW"
    exit 0
fi
print_message ".env ready for ${APP_ENV}" "$GREEN"

print_header "Installing Dependencies"
npm install
print_message "Dependencies installed" "$GREEN"

print_header "Building Application"
npm run build

if [ ! -d "dist" ]; then
    print_message "Build directory (dist) not found" "$RED"
    exit 1
fi
print_message "Build completed" "$GREEN"

print_header "Deploying Application"
sudo mkdir -p "${DEPLOY_PATH}"
sudo chown -R "$USER:www-data" "${DEPLOY_PATH}"

if [ -d "${DEPLOY_PATH}/current" ]; then
    BACKUP_NAME="backup-$(date +%Y%m%d-%H%M%S)"
    sudo mv "${DEPLOY_PATH}/current" "${DEPLOY_PATH}/${BACKUP_NAME}"
    print_message "Backup created: ${BACKUP_NAME}" "$GREEN"
fi

sudo mkdir -p "${DEPLOY_PATH}/current"
sudo cp -r dist/* "${DEPLOY_PATH}/current/"
sudo chown -R www-data:www-data "${DEPLOY_PATH}/current"
sudo chmod -R 755 "${DEPLOY_PATH}/current"
print_message "Files deployed" "$GREEN"

print_header "Configuring Nginx"

sudo tee "/etc/nginx/sites-available/${NGINX_SITE}" > /dev/null << EOFNGINX
server {
    listen ${NGINX_PORT};
    server_name ${SERVER_HOST} _;

    absolute_redirect off;
    port_in_redirect off;

    root ${DEPLOY_PATH}/current;
    index index.html;

    access_log /var/log/nginx/${NGINX_SITE}-access.log;
    error_log /var/log/nginx/${NGINX_SITE}-error.log;

    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/xml text/javascript application/x-javascript application/xml+rss application/javascript application/json;

    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    location = /health {
        access_log off;
        default_type text/plain;
        return 200 "healthy\n";
    }

    location ~* \.(jpg|jpeg|png|gif|ico|css|js|svg|woff|woff2|ttf|eot)\$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    location / {
        try_files \$uri /index.html;
    }
}
EOFNGINX

sudo ln -sf "/etc/nginx/sites-available/${NGINX_SITE}" /etc/nginx/sites-enabled/
print_message "Nginx configuration written: ${NGINX_SITE}" "$GREEN"

sudo nginx -t
sudo systemctl reload nginx
print_message "Nginx reloaded" "$GREEN"

print_header "Verifying Deployment"

if [ ! -f "${DEPLOY_PATH}/current/index.html" ]; then
    print_message "index.html not found in deployment directory" "$RED"
    exit 1
fi

sleep 2
if curl -sf "http://localhost:${NGINX_PORT}/health" > /dev/null; then
    print_message "Health check passed" "$GREEN"
else
    print_message "Health check failed (may need a moment to start)" "$YELLOW"
fi

cd "${DEPLOY_PATH}"
ls -t | grep backup | tail -n +4 | xargs -r sudo rm -rf

print_header "Deployment Completed Successfully (${APP_ENV})"
print_message "Application URL: http://${SERVER_HOST}:${NGINX_PORT}" "$GREEN"
print_message "Health Check: http://${SERVER_HOST}:${NGINX_PORT}/health" "$GREEN"
