CRATE_DIR := $(shell cd "$(dir $(lastword $(MAKEFILE_LIST)))" && pwd)
VIEM_CARGO := $(CRATE_DIR)/viem/Cargo.toml
TARGET_DIR := $(CRATE_DIR)/target/wasm32-unknown-unknown/release
WASM_FILE := $(TARGET_DIR)/eip712_mapper_viem.wasm

# Find all Rust source files for dependency tracking
CORE_SRC := $(shell find $(CRATE_DIR)/core/src -name '*.rs' 2>/dev/null)
VIEM_SRC := $(shell find $(CRATE_DIR)/viem/src -name '*.rs' 2>/dev/null)
ALL_SRC := $(CORE_SRC) $(VIEM_SRC) $(CRATE_DIR)/core/Cargo.toml $(VIEM_CARGO) $(CRATE_DIR)/Cargo.toml

.PHONY: all build test clean help

all: build ## Build prod + dev WASM binaries (default)

build: $(TARGET_DIR)/eip712_mapper_viem_prod.wasm $(TARGET_DIR)/eip712_mapper_viem_dev.wasm ## Build prod + dev WASM binaries
	@cp $(TARGET_DIR)/eip712_mapper_viem_prod.wasm $(WASM_FILE)
	@echo "Done. Output:"
	@echo "  $(WASM_FILE) (prod, default)"
	@echo "  $(TARGET_DIR)/eip712_mapper_viem_prod.wasm"
	@echo "  $(TARGET_DIR)/eip712_mapper_viem_dev.wasm"

$(TARGET_DIR)/eip712_mapper_viem_prod.wasm: $(ALL_SRC)
	@echo "Building prod WASM..."
	@# Temporarily switch crate-type to cdylib for WASM build
	@sed -i.bak 's/crate-type = \["lib"\]/crate-type = ["cdylib"]/' "$(VIEM_CARGO)"
	@cargo build --target wasm32-unknown-unknown --release --manifest-path "$(VIEM_CARGO)" \
		&& ( \
			cp "$(WASM_FILE)" "$@"; \
			if command -v wasm-opt > /dev/null 2>&1; then \
				wasm-opt -Oz --enable-bulk-memory "$@" -o "$@"; \
			fi; \
			echo "Prod: $$(wc -c < "$@" | tr -d ' ') bytes ($$(gzip -c "$@" | wc -c | tr -d ' ') gzipped)"; \
			mv "$(VIEM_CARGO).bak" "$(VIEM_CARGO)"; \
		) || ( \
			mv "$(VIEM_CARGO).bak" "$(VIEM_CARGO)"; \
			exit 1; \
		)

$(TARGET_DIR)/eip712_mapper_viem_dev.wasm: $(ALL_SRC)
	@echo "Building dev WASM..."
	@# Temporarily switch crate-type to cdylib for WASM build
	@sed -i.bak 's/crate-type = \["lib"\]/crate-type = ["cdylib"]/' "$(VIEM_CARGO)"
	@cargo build --target wasm32-unknown-unknown --release --features dev --manifest-path "$(VIEM_CARGO)" \
		&& ( \
			cp "$(WASM_FILE)" "$@"; \
			if command -v wasm-opt > /dev/null 2>&1; then \
				wasm-opt -Oz --enable-bulk-memory "$@" -o "$@"; \
			fi; \
			echo "Dev:  $$(wc -c < "$@" | tr -d ' ') bytes ($$(gzip -c "$@" | wc -c | tr -d ' ') gzipped)"; \
			mv "$(VIEM_CARGO).bak" "$(VIEM_CARGO)"; \
		) || ( \
			mv "$(VIEM_CARGO).bak" "$(VIEM_CARGO)"; \
			exit 1; \
		)

test: ## Run native Rust tests for both crates
	cargo test --manifest-path "$(CRATE_DIR)/Cargo.toml"

clean: ## Remove build artifacts
	cargo clean --manifest-path "$(CRATE_DIR)/Cargo.toml"

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-15s\033[0m %s\n", $$1, $$2}'
