#[path = "../tests/support/lane_gate.rs"]
mod gate;
#[unsafe(no_mangle)]
pub extern "C" fn lane_gate() -> u32 {
    u32::from(gate::run().is_ok())
}
fn main() {}
