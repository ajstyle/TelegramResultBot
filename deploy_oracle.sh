#!/bin/bash
# Oracle Cloud VPS Deployment Script for Telegram Result Bot

echo "===================================================="
echo " 🚀 Deploying Latest Telegram Result Bot on Oracle VPS"
echo "===================================================="

# 1. Pull latest code from GitHub main branch
echo "[1/4] Pulling latest code from GitHub main branch..."
git fetch origin main
git reset --hard origin/main

# 2. Install production dependencies
echo "[2/4] Installing dependencies..."
npm install --production

# 3. Restart application with PM2 process manager
echo "[3/4] Restarting process with PM2..."
if pm2 list | grep -q "telegram-bot"; then
  pm2 restart telegram-bot
else
  pm2 start src/server.js --name "telegram-bot"
fi

# 4. Save PM2 state for automatic reboot persistence
echo "[4/4] Saving PM2 state..."
pm2 save

echo "===================================================="
echo " ✅ Successfully Deployed on Oracle Cloud Server!"
echo "===================================================="
