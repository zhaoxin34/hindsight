# Hindsight Chatbot — service management
# Primary purpose: restart the Next.js dev server (the pnpm service).

CHATBOT_DIR  := chatbot
LOG_FILE     := /tmp/claude/next-dev.log

.PHONY: dev stop restart status logs clean help

.DEFAULT_GOAL := help

help: ## List available commands
	@grep -hE '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

# dev is the workhorse: kill any running instance, then start fresh.
# `restart` is just an alias — same effect, friendlier name for the main flow.
#
# Implementation note: we spawn `pnpm dev` via `python3 -c 'os.setsid()...'`
# instead of `nohup ... &` so that pnpm/next-dev runs in its own session and
# process group. Without this, when the parent shell exits (e.g. a CI/agent
# timeout), the SIGTERM goes to the whole process group and kills the dev
# server. macOS does not ship a `setsid(1)` binary, so we use Python's
# os.setsid() syscall wrapper.
dev stop: ## Internal: kill any running dev server
	pkill -f "next dev" 2>/dev/null && echo "✅ stopped" || echo "⚠️  no dev server running"

dev: stop ## Start the dev server (returns immediately — use `make logs` to tail output)
	@echo "🚀 Starting dev server in $(CHATBOT_DIR)..."
	@cd $(CHATBOT_DIR) && BAILIAN_API_KEY="$$BAILIAN_API_KEY" python3 -c "import os, subprocess; os.setsid(); subprocess.Popen(['pnpm', 'dev'], stdin=subprocess.DEVNULL, stdout=open('$(LOG_FILE)', 'w'), stderr=subprocess.STDOUT)"
	@echo "📋 log: $(LOG_FILE) — run 'make logs' to follow, 'make status' to check health"

restart: dev ## Restart the dev server (main target)

status: ## Check service health (chatbot + Hindsight)
	@printf "chatbot:   "; curl -s http://localhost:3000/ -o /dev/null -w "HTTP %{http_code}\n" 2>&1 || echo "down"
	@printf "hindsight: "; curl -s http://localhost:8888/health 2>&1 | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','?'), '(db:', d.get('database','?') + ')')" 2>/dev/null || echo "unreachable"

logs: ## Tail the dev server log (Ctrl-C to exit)
	@tail -f $(LOG_FILE)

clean: stop ## Stop server and remove Next build cache
	@rm -rf $(CHATBOT_DIR)/.next
	@echo "✅ cleaned"