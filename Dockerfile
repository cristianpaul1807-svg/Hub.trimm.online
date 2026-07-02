# Build stage for TRIMM Hub
FROM node:18-alpine as build
WORKDIR /app
# Copy root package.json and lock file to install dependencies
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
# Copy the entire project
COPY . .
# Build the Hub application
RUN pnpm run build:hub

# Production stage for TRIMM Hub
FROM nginx:stable-alpine
# Copy the build output of the Hub to replace the default nginx contents.
COPY --from=build /app/dist-hub /usr/share/nginx/html
# Custom nginx configuration to handle React Router (Single Page Application)
# This ensures that all requests are redirected to index.html
RUN echo 'server { \
    listen 80; \
    location / { \
        root /usr/share/nginx/html; \
        index index.html index.htm; \
        try_files $uri $uri/ /index.html; \
    } \
}' > /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
