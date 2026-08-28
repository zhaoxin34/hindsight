# Hindsight Chatbot — service management
# Primary purpose: restart the Next.js dev server (the npm service).

CHATBOT_DIR  := chatbot
LOG_FILE     := /tmp/claude/next-dev.log
PID_FILE     := /tmp/claude/next-dev.pid

.PHONY: dev stop restart status logs clean help

.DEFAULT_GOAL := help

help: ## List available commands
	@grep -hE '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

# dev is the workhorse: kill any running instance, then start fresh.
# `restart` is just an alias — same effect, friendlier name for the main flow.
dev stop: ## Internal: kill any running dev server
	pkill -f "next dev" 2>/dev/null && echo "✅ stopped" || echo "⚠️  no dev server running"
	@-rm -f $(PID_FILE)

dev: stop ## Start the dev server (kills any existing instance first)
	@echo "🚀 Starting dev server in $(CHATBOT_DIR)..."
	@cd $(CHATBOT_DIR) && BAILIAN_API_KEY="$$BAILIAN_API_KEY" nohup npm run dev > $(LOG_FILE) 2>&1 &
	@echo $$! > $(PID_FILE)
	@sleep 4
	@echo "📋 log: $(LOG_FILE)"
	@tail -8 $(LOG_FILE)

restart: dev ## Restart the dev server (main target)

status: ## Check service health (chatbot + Hindsight)
	@printf "chatbot:   "; curl -s http://localhost:3000/ -o /dev/null -w "HTTP %{http_code}\n" 2>&1 || echo "down"
	@printf "hindsight: "; curl -s http://localhost:8888/health 2>&1 | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','?'), '(db:', d.get('database','?') + ')')" 2>/dev/null || echo "unreachable"

logs: ## Tail the dev server log (Ctrl-C to exit)
	@tail -f $(LOG_FILE)

clean: stop ## Stop server and remove Next build cache
	@rm -rf $(CHATBOT_DIR)/.next
	@echo "✅ cleaned"