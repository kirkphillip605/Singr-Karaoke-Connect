.PHONY: help install dev build test lint format clean

help: ## Show this help message
	@echo 'Usage: make [target]'
	@echo ''
	@echo 'Available targets:'
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  %-20s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

install: ## Install dependencies
	pnpm install

dev-up: ## Start local services (Docker)
	docker-compose up -d
	@echo "Waiting for services to be ready..."
	@sleep 5

dev-down: ## Stop local services
	docker-compose down

dev-logs: ## Show Docker logs
	docker-compose logs -f

dev: dev-up ## Start development server
	pnpm dev

build: ## Build all packages
	pnpm build

test: ## Run tests
	pnpm test

test-coverage: ## Run tests with coverage
	pnpm test:coverage

lint: ## Lint code
	pnpm lint

format: ## Format code
	pnpm format

format-check: ## Check code formatting
	pnpm format:check

type-check: ## Type check TypeScript
	pnpm type-check

clean: ## Clean build artifacts and dependencies
	pnpm clean
	docker-compose down -v

db-migrate-dev: ## Run database migrations (dev)
	pnpm db:migrate:dev

db-migrate-deploy: ## Deploy database migrations (prod)
	pnpm db:migrate:deploy

db-generate: ## Generate Prisma client
	pnpm db:generate

db-seed: ## Seed database
	pnpm db:seed

db-studio: ## Open Prisma Studio
	pnpm db:studio

db-reset: ## Reset database (dangerous!)
	@read -p "Are you sure you want to reset the database? [y/N] " -n 1 -r; \
	echo; \
	if [[ $$REPLY =~ ^[Yy]$$ ]]; then \
		pnpm --filter @singr/database db:reset; \
	fi

setup: install dev-up db-generate db-migrate-dev db-seed ## Complete project setup
	@echo "Setup complete! Run 'make dev' to start development."

api-dev: ## Start API server only
	pnpm api:dev

worker-dev: ## Start worker only
	pnpm worker:dev
