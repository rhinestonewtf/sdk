.PHONY: wasm wasm-test wasm-clean

wasm:
	cd crates/encoding-wasm && wasm-pack build --target web --release

wasm-test:
	cd crates/encoding-core && cargo test

wasm-clean:
	rm -rf target crates/encoding-wasm/pkg
