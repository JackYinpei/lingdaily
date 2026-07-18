FROM node:20-alpine
WORKDIR /app

COPY package*.json ./
RUN npm ci

RUN apk add --no-cache tzdata
ENV TZ=Asia/Shanghai

COPY . .

# NEXT_PUBLIC_* 变量在构建时被打包进客户端代码，需作为 build arg 传入
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_GEMINI_BASE_URL
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_GEMINI_BASE_URL=$NEXT_PUBLIC_GEMINI_BASE_URL

# Server Actions 加密密钥。必须在构建期就固定，并在运行时保持同一个值：
# Next.js 用它加密内联 Server Action 的闭包并派生 action ID，缺省时每次构建都会
# 随机生成，导致重新部署后旧标签页请求命中 "Failed to find Server Action"。
ARG NEXT_SERVER_ACTIONS_ENCRYPTION_KEY
ENV NEXT_SERVER_ACTIONS_ENCRYPTION_KEY=$NEXT_SERVER_ACTIONS_ENCRYPTION_KEY

# Fail loudly instead of silently baking a random per-build key (which would
# reintroduce the "Failed to find Server Action" regression). Pass the arg via
# --build-arg locally or the NEXT_SERVER_ACTIONS_ENCRYPTION_KEY CI secret.
RUN if [ -z "$NEXT_SERVER_ACTIONS_ENCRYPTION_KEY" ]; then \
      echo "ERROR: NEXT_SERVER_ACTIONS_ENCRYPTION_KEY build arg is required." >&2; \
      echo "Generate a stable key once with: openssl rand -base64 32" >&2; \
      exit 1; \
    fi

RUN npm run build

EXPOSE 8000
CMD ["npm", "start"]
