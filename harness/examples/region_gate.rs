#[unsafe(no_mangle)]
pub extern "C" fn region_gate() -> u32 {
    u32::from(intersect_view_harness::probe::regions().is_ok())
}
