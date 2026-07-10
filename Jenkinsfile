pipeline {
    agent any

    environment {
        APP_NAME = 'simplipharma-admin'
        SERVER_HOST = '103.230.227.5'
    }

    stages {
        // Code is checked out by "Pipeline script from SCM" (Declarative: Checkout SCM).
        // Do not re-checkout a fixed branch here — that would break develop deploys.

        stage('Resolve Environment') {
            steps {
                script {
                    def branch = (env.BRANCH_NAME ?: env.GIT_BRANCH ?: '').replaceAll('^origin/', '')
                    echo "Detected branch: ${branch}"

                    if (branch == 'develop') {
                        env.APP_ENV = 'dev'
                        env.DEPLOY_PATH = "/var/www/${env.APP_NAME}-dev"
                        env.NGINX_PORT = '8083'
                        env.NGINX_SITE = "${env.APP_NAME}-dev"
                        // Temporarily reuse prod Firebase secrets until a separate dev project is ready
                        env.FB_CRED_PREFIX = 'simplipharma-firebase'
                    } else if (branch == 'main' || branch == 'master') {
                        env.APP_ENV = 'prod'
                        env.DEPLOY_PATH = "/var/www/${env.APP_NAME}"
                        env.NGINX_PORT = '8085'
                        env.NGINX_SITE = env.APP_NAME
                        env.FB_CRED_PREFIX = 'simplipharma-firebase'
                    } else {
                        error("Unsupported branch '${branch}'. Deploy only from 'develop' (dev) or 'main' (prod).")
                    }

                    echo "Environment: ${env.APP_ENV}"
                    echo "Deploy path: ${env.DEPLOY_PATH}"
                    echo "Nginx port: ${env.NGINX_PORT}"
                    echo "Nginx site: ${env.NGINX_SITE}"
                    echo "Firebase credentials prefix: ${env.FB_CRED_PREFIX}"
                }
            }
        }

        stage('Setup Node.js') {
            steps {
                script {
                    echo 'Setting up Node.js environment...'
                    try {
                        def nodeHome = tool name: 'nodejs', type: 'nodejs'
                        env.PATH = "${nodeHome}/bin:${env.PATH}"
                        echo "Using NodeJS plugin: ${nodeHome}"
                    } catch (Exception e) {
                        echo 'NodeJS plugin not configured, using system Node.js'
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
                echo "Creating .env file for ${env.APP_ENV} (credentials: ${env.FB_CRED_PREFIX}-*)..."
                script {
                    def prefix = env.FB_CRED_PREFIX
                    withCredentials([
                        string(credentialsId: "${prefix}-api-key", variable: 'FB_API_KEY'),
                        string(credentialsId: "${prefix}-auth-domain", variable: 'FB_AUTH_DOMAIN'),
                        string(credentialsId: "${prefix}-project-id", variable: 'FB_PROJECT_ID'),
                        string(credentialsId: "${prefix}-storage-bucket", variable: 'FB_STORAGE_BUCKET'),
                        string(credentialsId: "${prefix}-messaging-sender-id", variable: 'FB_MESSAGING_SENDER_ID'),
                        string(credentialsId: "${prefix}-app-id", variable: 'FB_APP_ID')
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
        }

        stage('Build Application') {
            steps {
                echo "Building ${env.APP_ENV} static files..."
                sh 'npm run build'
            }
        }

        stage('Create Deployment Directory') {
            steps {
                echo "Creating deployment directory ${env.DEPLOY_PATH}..."
                sh """
                    sudo mkdir -p ${DEPLOY_PATH}
                    sudo chown -R \$USER:www-data ${DEPLOY_PATH}
                """
            }
        }

        stage('Deploy to Server') {
            steps {
                echo "Deploying ${env.APP_ENV} to ${env.DEPLOY_PATH}..."
                sh """
                    if [ -d "${DEPLOY_PATH}/current" ]; then
                        sudo mv ${DEPLOY_PATH}/current ${DEPLOY_PATH}/backup-\$(date +%Y%m%d-%H%M%S) || true
                    fi

                    sudo mkdir -p ${DEPLOY_PATH}/current
                    sudo cp -r dist/* ${DEPLOY_PATH}/current/

                    sudo chown -R www-data:www-data ${DEPLOY_PATH}/current
                    sudo chmod -R 755 ${DEPLOY_PATH}/current

                    cd ${DEPLOY_PATH} && ls -t | grep backup | tail -n +4 | xargs -r sudo rm -rf
                """
            }
        }

        stage('Configure Nginx') {
            steps {
                echo "Configuring Nginx site ${env.NGINX_SITE} on port ${env.NGINX_PORT}..."
                sh """
                    sudo tee /etc/nginx/sites-available/${NGINX_SITE} > /dev/null << EOFNGINX
server {
    listen ${NGINX_PORT};
    server_name ${SERVER_HOST} _;

    # Avoid Host/IP absolute redirects (fixes ERR_TOO_MANY_REDIRECTS / 301 to 127.0.0.1)
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
        return 200 "healthy\\n";
    }

    location ~* \\.(jpg|jpeg|png|gif|ico|css|js|svg|woff|woff2|ttf|eot)\\\$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # SPA routing — avoid directory slash redirects
    location / {
        try_files \\\$uri /index.html;
    }
}
EOFNGINX

                    sudo ln -sf /etc/nginx/sites-available/${NGINX_SITE} /etc/nginx/sites-enabled/
                    sudo nginx -t
                    sudo systemctl reload nginx
                """
            }
        }

        stage('Verify Deployment') {
            steps {
                echo "Verifying ${env.APP_ENV} deployment..."
                sh """
                    if [ ! -f "${DEPLOY_PATH}/current/index.html" ]; then
                        echo "ERROR: index.html not found in deployment directory"
                        exit 1
                    fi

                    sudo systemctl status nginx --no-pager || true
                    sleep 2
                    curl -f http://localhost:${NGINX_PORT}/health || echo "Warning: Health check failed"

                    echo "Deployment completed successfully!"
                    echo "Environment: ${APP_ENV}"
                    echo "Application accessible at: http://${SERVER_HOST}:${NGINX_PORT}"
                """
            }
        }
    }

    post {
        success {
            echo "Deployment completed successfully! (${env.APP_ENV})"
            echo "Access the application at: http://${env.SERVER_HOST}:${env.NGINX_PORT}"
        }

        failure {
            echo 'Deployment failed! Check the logs for details.'
            sh """
                if [ -n "${DEPLOY_PATH}" ] && ls -d ${DEPLOY_PATH}/backup-* 1> /dev/null 2>&1; then
                    echo "Rolling back to previous version..."
                    sudo rm -rf ${DEPLOY_PATH}/current
                    LATEST_BACKUP=\$(ls -t ${DEPLOY_PATH} | grep backup | head -n 1)
                    if [ -n "\$LATEST_BACKUP" ]; then
                        sudo mv ${DEPLOY_PATH}/\$LATEST_BACKUP ${DEPLOY_PATH}/current
                        if sudo nginx -t; then
                            sudo systemctl reload nginx
                            echo "Rollback completed successfully"
                        else
                            echo "Rollback files restored but nginx config is invalid — fix sites-enabled and reload"
                        fi
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
