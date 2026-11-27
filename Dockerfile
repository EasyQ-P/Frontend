# EasyQ 프론트 운영 이미지 (설계서: EC2의 frontend 컨테이너, Caddy 뒤 :3000)
# Next.js output: "standalone" 결과물만 담아 이미지를 작게 만든다.
#
#   docker build -t easyq-frontend .
#   docker run -p 3000:3000 easyq-frontend
#
# 시연용(목업) 이미지는 --build-arg NEXT_PUBLIC_DEMO=true 로 빌드한다.
# NEXT_PUBLIC_* 값은 빌드할 때 코드에 들어가므로 실행할 때(-e)는 바꿀 수 없다.

# ── 1. 의존성 설치 ──
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ── 2. 빌드 ──
FROM node:24-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_DEMO=""
ENV NEXT_PUBLIC_DEMO=$NEXT_PUBLIC_DEMO
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ── 3. 실행 ──
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Caddy가 같은 Docker 네트워크에서 frontend:3000으로 들어오므로 모든 주소에서 받는다
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

# root가 아닌 계정으로 실행한다
RUN addgroup -S -g 1001 nodejs && adduser -S -u 1001 -G nodejs nextjs

# standalone 서버 + 정적 파일(.next/static). public 폴더는 아직 없다
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
