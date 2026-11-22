//! Applicability hints. Candidate analysis remains the authority for edits.
use crate::{ElementId, EngineError, EngineLimits, ViewFunctions, ViewModel};
use intersect_views::{Binding, GraphRuleSet, GraphScene, Node, Tool};
use std::collections::BTreeSet;
pub fn nodes(scene: &GraphScene) -> Vec<&Node> {
    fn visit<'a>(nodes: &'a [Node], result: &mut Vec<&'a Node>) {
        for node in nodes {
            result.push(node);
            visit(&node.children, result);
            if let Some(regions) = &node.regions {
                for r in &regions.items {
                    visit(&r.children, result);
                }
            }
        }
    }
    let mut result = vec![];
    visit(&scene.nodes, &mut result);
    result
}
pub fn endpoint<'a>(scene: &'a GraphScene, id: &str) -> Option<&'a Binding> {
    for node in nodes(scene) {
        if node.id == id {
            return Some(&node.binding);
        }
        if let Some(port) = node.ports.iter().find(|p| p.id == id) {
            return Some(&port.binding);
        }
    }
    None
}
pub fn command_for(rules: &GraphRuleSet, tool: &Tool) -> Option<String> {
    if rules
        .symbols
        .iter()
        .flat_map(|r| &r.create)
        .any(|c| c.tool == tool.id && c.command == tool.command)
        || rules
            .edges
            .iter()
            .filter_map(|e| e.connect())
            .any(|c| c.command == tool.command)
    {
        Some(tool.command.clone())
    } else {
        None
    }
}
/// Return IDs in scene order. With source absent, connection results are legal
/// starting endpoints; with source present, they are legal target endpoints.
pub fn targets(
    rules: &GraphRuleSet,
    scene: &GraphScene,
    tool: &Tool,
    source: Option<&str>,
    model: &dyn ViewModel,
    functions: &dyn ViewFunctions,
    limits: EngineLimits,
) -> Result<Vec<String>, EngineError> {
    let mut work = 0usize;
    let mut predicate = |name: &str, binding: &Binding| -> Result<bool, EngineError> {
        if binding.read_only {
            return Ok(false);
        }
        work += 1;
        if work > limits.function_work {
            return Err(EngineError::limit("function-call work units"));
        }
        let id: ElementId = model
            .element(&binding.key)
            .ok_or_else(|| EngineError("Target element no longer exists".into()))?;
        functions.boolean(name, id)
    };
    let mut result = vec![];
    let mut seen = BTreeSet::new();
    for node in nodes(scene) {
        if source.is_none() {
            for create in rules
                .symbols
                .iter()
                .filter(|r| r.id == node.rule)
                .flat_map(|r| &r.create)
            {
                if create.tool == tool.id
                    && create.command == tool.command
                    && predicate(&create.accepts, &node.binding)?
                    && seen.insert(node.id.clone())
                {
                    result.push(node.id.clone());
                }
            }
        }
        for edge in &rules.edges {
            let Some(connect) = edge.connect().filter(|c| c.command == tool.command) else {
                continue;
            };
            if let Some(source) = source {
                let binding = endpoint(scene, source)
                    .ok_or_else(|| EngineError("Unknown source symbol".into()))?;
                if !predicate(&connect.source_accepts, binding)? {
                    continue;
                }
            }
            let name = if source.is_some() {
                &connect.target_accepts
            } else {
                &connect.source_accepts
            };
            for (id, binding) in std::iter::once((&node.id, &node.binding))
                .chain(node.ports.iter().map(|p| (&p.id, &p.binding)))
            {
                if predicate(name, binding)? && seen.insert(id.clone()) {
                    result.push(id.clone());
                }
            }
        }
    }
    Ok(result)
}
