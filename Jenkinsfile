pipeline {
    agent any
    
    environment {
        // Application Configuration
        APP_NAME = 'simplipharma-admin'
        DEPLOY_PATH = "/var/www/${APP_NAME}"
        NGINX_PORT = '8085'
    }
    
    stages {
        stage('Checkout') {
            steps {
                echo 'Checking out code from repository...'
                git branch: 'main',
                    url: 'https://github.com/chankey91/simplipharma-web-admin.git'
            }
        }
        
        stage('Setup Node.js') {
            steps {
                script {
                    echo 'Setting up Node.js environment...'
                    // Try to use NodeJS plugin if configured, otherwise use system Node.js
                    try {
                        def nodeHome = tool name: 'nodejs', type: 'nodejs'
                        env.PATH = "${nodeHome}/bin:${env.PATH}"
                        echo "Using NodeJS plugin: ${nodeHome}"
                    } catch (Exception e) {
                        echo "NodeJS plugin not configured, using system Node.js"
                    }
                    sh 'node -v'
                    sh 'npm -v'
                }
            }
        }
        
        stage('Install Dependencies') {
            steps {
                echo 'Installing Node.js dependencies...'
                sh 'npm install'
            }
        }
        
        stage('Create Environment File') {
            steps {
                echo 'Creating .env file with Firebase credentials...'
                withCredentials([
                    string(credentialsId: 'simplipharma-firebase-api-key', variable: 'FB_API_KEY'),
                    string(credentialsId: 'simplipharma-firebase-auth-domain', variable: 'FB_AUTH_DOMAIN'),
                    string(credentialsId: 'simplipharma-firebase-project-id', variable: 'FB_PROJECT_ID'),
                    string(credentialsId: 'simplipharma-firebase-storage-bucket', variable: 'FB_STORAGE_BUCKET'),
                    string(credentialsId: 'simplipharma-firebase-messaging-sender-id', variable: 'FB_MESSAGING_SENDER_ID'),
                    string(credentialsId: 'simplipharma-firebase-app-id', variable: 'FB_APP_ID')
                ]) {
                    sh '''
                        cat > .env << EOF
VITE_FIREBASE_API_KEY=${FB_API_KEY}
VITE_FIREBASE_AUTH_DOMAIN=${FB_AUTH_DOMAIN}
VITE_FIREBASE_PROJECT_ID=${FB_PROJECT_ID}
VITE_FIREBASE_STORAGE_BUCKET=${FB_STORAGE_BUCKET}
VITE_FIREBASE_MESSAGING_SENDER_ID=${FB_MESSAGING_SENDER_ID}
VITE_FIREBASE_APP_ID=${FB_APP_ID}
VITE_APP_NAME="SimpliPharma Admin Panel"
VITE_APP_VERSION=1.0.0
EOF
                    '''
                }
            }
        }
        
        stage('Build Application') {
            steps {
                echo 'Building production-ready static files...'
                sh 'npm run build'
            }
        }
        
        stage('Create Deployment Directory') {
            steps {
                echo 'Creating deployment directory if it doesn\'t exist...'
                sh """
                    sudo mkdir -p ${DEPLOY_PATH}
                    sudo chown -R \$USER:www-data ${DEPLOY_PATH}
                """
            }
        }
        
        stage('Deploy to Server') {
            steps {
                echo 'Deploying static files to web server...'
                sh """
                    # Backup existing deployment (if any)
                    if [ -d "${DEPLOY_PATH}/current" ]; then
                        sudo mv ${DEPLOY_PATH}/current ${DEPLOY_PATH}/backup-\$(date +%Y%m%d-%H%M%S) || true
                    fi
                    
                    # Deploy new build
                    sudo mkdir -p ${DEPLOY_PATH}/current
                    sudo cp -r dist/* ${DEPLOY_PATH}/current/
                    
                    # Set proper permissions
                    sudo chown -R www-data:www-data ${DEPLOY_PATH}/current
                    sudo chmod -R 755 ${DEPLOY_PATH}/current
                    
                    # Clean old backups (keep last 3)
                    cd ${DEPLOY_PATH} && ls -t | grep backup | tail -n +4 | xargs -r sudo rm -rf
                """
            }
        }
        
        stage('Configure Nginx') {
            steps {
                echo 'Configuring Nginx for the application...'
                sh '''
                    # Create Nginx configuration
                    sudo tee /etc/nginx/sites-available/simplipharma-admin > /dev/null << 'EOFNGINX'
server {
    listen 8085;
    server_name 103.230.227.5;
    
    root /var/www/simplipharma-admin/current;
    index index.html;
    
    # Logging
    access_log /var/log/nginx/simplipharma-admin-access.log;
    error_log /var/log/nginx/simplipharma-admin-error.log;
    
    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/xml text/javascript application/x-javascript application/xml+rss application/javascript application/json;
    
    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    
    # Cache static assets
    location ~* \\.(jpg|jpeg|png|gif|ico|css|js|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
    
    # SPA routing - serve index.html for all routes
    location / {
        try_files $uri $uri/ /index.html;
    }
    
    # Health check endpoint
    location /health {
        access_log off;
        return 200 "healthy\\n";
        add_header Content-Type text/plain;
    }
}
EOFNGINX
                    
                    # Enable site
                    sudo ln -sf /etc/nginx/sites-available/simplipharma-admin /etc/nginx/sites-enabled/
                    
                    # Test Nginx configuration
                    sudo nginx -t
                    
                    # Reload Nginx
                    sudo systemctl reload nginx
                '''
            }
        }
        
        stage('Verify Deployment') {
            steps {
                echo 'Verifying deployment...'
                sh """
                    # Check if files exist
                    if [ ! -f "${DEPLOY_PATH}/current/index.html" ]; then
                        echo "ERROR: index.html not found in deployment directory"
                        exit 1
                    fi
                    
                    # Check Nginx status
                    sudo systemctl status nginx --no-pager || true
                    
                    # Test endpoint
                    sleep 2
                    curl -f http://localhost:${NGINX_PORT}/health || echo "Warning: Health check failed"
                    
                    echo "Deployment completed successfully!"
                    echo "Application accessible at: http://103.230.227.5:${NGINX_PORT}"
                """
            }
        }
    }
    
    post {
        success {
            echo '✅ Deployment completed successfully!'
            echo "Access the application at: http://103.230.227.5:${NGINX_PORT}"
        }
        
        failure {
            echo '❌ Deployment failed! Check the logs for details.'
            sh """
                # Check if any backup directories exist
                if ls -d ${DEPLOY_PATH}/backup-* 1> /dev/null 2>&1; then
                    echo "Rolling back to previous version..."
                    sudo rm -rf ${DEPLOY_PATH}/current
                    LATEST_BACKUP=\$(ls -t ${DEPLOY_PATH} | grep backup | head -n 1)
                    if [ -n "\$LATEST_BACKUP" ]; then
                        sudo mv ${DEPLOY_PATH}/\$LATEST_BACKUP ${DEPLOY_PATH}/current
                        sudo systemctl reload nginx
                        echo "Rollback completed successfully"
                    fi
                fi
            """
        }
        
        always {
            echo 'Cleaning up workspace...'
            cleanWs()
        }
    }
}

