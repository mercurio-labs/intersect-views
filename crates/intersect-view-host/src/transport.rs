//! Bounded, application-owned WASM transport. No pack or filesystem support.
use crate::Host;
pub struct WasmTransport {
    input: Vec<u8>,
    output: Vec<u8>,
    host: Option<Host>,
}
impl Default for WasmTransport {
    fn default() -> Self {
        Self::new()
    }
}
impl WasmTransport {
    pub const fn new() -> Self {
        Self {
            input: Vec::new(),
            output: Vec::new(),
            host: None,
        }
    }
    pub fn input_buffer(&mut self, length: usize) -> *mut u8 {
        if length > 16 * 1024 * 1024 {
            // A failed allocation must not leave the preceding request executable.
            self.input.clear();
            return std::ptr::null_mut();
        }
        self.input.resize(length, 0);
        self.input.as_mut_ptr()
    }
    pub fn execute(&mut self, factory: impl FnOnce() -> Result<Host, String>) -> usize {
        let result = (|| {
            let request =
                serde_json::from_slice(&self.input).map_err(|e| format!("Invalid request: {e}"))?;
            if self.host.is_none() {
                self.host = Some(factory()?);
            }
            self.host
                .as_mut()
                .ok_or("Host initialization failed")?
                .dispatch(request)
        })();
        let response = match result {
            Ok(value) => value,
            Err(message) => serde_json::json!({"error":message}),
        };
        self.output = response.to_string().into_bytes();
        self.output.len()
    }
    pub fn output_buffer(&self) -> *const u8 {
        self.output.as_ptr()
    }
}
/// Invoke once in a language cdylib. Its factory returns a configured Host.
#[macro_export]
macro_rules! export_host {
    ($factory:expr) => {
        #[cfg(target_arch="wasm32")]
        mod intersect_wasm_exports {
            std::thread_local! { static TRANSPORT: std::cell::RefCell<$crate::WasmTransport> = const { std::cell::RefCell::new($crate::WasmTransport::new()) }; }
            #[unsafe(no_mangle)] pub extern "C" fn input_buffer(length: usize) -> *mut u8 { TRANSPORT.with(|t|t.borrow_mut().input_buffer(length)) }
            #[unsafe(no_mangle)] pub extern "C" fn execute() -> usize { TRANSPORT.with(|t|t.borrow_mut().execute($factory)) }
            #[unsafe(no_mangle)] pub extern "C" fn output_buffer() -> *const u8 { TRANSPORT.with(|t|t.borrow().output_buffer()) }
        }
    };
}
