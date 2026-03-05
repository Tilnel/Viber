#!/bin/bash

echo "🚀 Kimi Code Web Assistant 启动脚本"
echo "================================"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if .env exists
if [ ! -f .env ]; then
    echo -e "${YELLOW}⚠️  .env file not found, creating from example...${NC}"
    cp .env.example .env
fi

# Load environment variables
export $(grep -v '^#' .env | xargs)

echo ""
echo "📋 配置信息:"
echo "   数据库: $DB_NAME@$DB_HOST:$DB_PORT"
echo "   服务端: http://localhost:$PORT"
echo "   代码目录: $ROOT_DIR"
echo ""

# Check if PostgreSQL is running
echo "🔍 检查 PostgreSQL..."
if pg_isready -h $DB_HOST -p $DB_PORT > /dev/null 2>&1; then
    echo -e "${GREEN}✅ PostgreSQL is running${NC}"
else
    echo -e "${RED}❌ PostgreSQL is not running${NC}"
    echo ""
    echo "💡 启动 PostgreSQL:"
    echo "   sudo systemctl start postgresql"
    echo ""
    exit 1
fi

# Check if database exists
echo "🔍 检查数据库..."
if PGPASSWORD=$DB_PASSWORD psql -U $DB_USER -h $DB_HOST -p $DB_PORT -d $DB_NAME -c '\q' > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Database exists${NC}"
else
    echo -e "${YELLOW}⚠️  Database does not exist, creating...${NC}"
    PGPASSWORD=$DB_PASSWORD psql -U $DB_USER -h $DB_HOST -p $DB_PORT -c "CREATE DATABASE $DB_NAME;" || {
        echo -e "${RED}❌ Failed to create database${NC}"
        echo ""
        echo "💡 请检查 PostgreSQL 配置:"
        echo "   1. 确保密码正确"
        echo "   2. 检查 pg_hba.conf 认证方式"
        echo "   3. 重启 PostgreSQL: sudo systemctl restart postgresql"
        echo ""
        exit 1
    }
fi

# Run migrations
echo ""
echo "🔄 运行数据库迁移..."
node src/server/db/migrate.js || exit 1

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo ""
    echo "📦 安装服务端依赖..."
    npm install || exit 1
fi

if [ ! -d "src/client/node_modules" ]; then
    echo ""
    echo "📦 安装客户端依赖..."
    cd src/client && npm install && cd ../.. || exit 1
fi

echo ""
echo -e "${GREEN}✅ 准备就绪！${NC}"
echo ""
echo "🌐 访问地址:"
echo "   开发模式: http://localhost:5173"
echo "   API: http://localhost:$PORT"
echo ""
echo "📖 快捷键:"
echo "   Ctrl+P - 快速打开文件"
echo "   Ctrl+Shift+F - 搜索"
echo "   Ctrl+L - 打开 AI 助手"
echo "   Ctrl+M - 语音输入"
echo ""
echo "🚀 启动开发服务器..."
echo "================================"
npm run dev
