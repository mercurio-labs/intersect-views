//! M9 semantic lane-graph wire contracts. No geometry or language feature names.
use super::*;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SemanticAxis {
    pub direction: String,
    pub semantic: bool,
}
impl SemanticAxis {
    pub fn validate(&self) -> Result<(), String> {
        if !self.semantic || !["horizontal", "vertical"].contains(&self.direction.as_str()) {
            return Err("Lane graph requires a declared semantic axis".into());
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Lane {
    pub id: String,
    pub rule: String,
    pub label: Label,
    pub binding: Binding,
    pub container: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LaneStep {
    pub id: String,
    pub rule: String,
    pub label: Label,
    pub binding: Binding,
    pub lane: String,
    pub rank: usize,
    pub unordered: bool,
    pub predecessors: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LaneSpan {
    pub id: String,
    pub step: String,
    pub end: String,
    pub lanes: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LaneGraphScene {
    pub schema_version: u32,
    pub form: String,
    pub rule_set: String,
    pub revision: u64,
    pub view: View,
    pub palette: Palette,
    pub problems: Vec<String>,
    pub axis: SemanticAxis,
    pub lanes: Vec<Lane>,
    /// Original combined selector order, used to break topological ties.
    pub steps: Vec<LaneStep>,
    pub spans: Vec<LaneSpan>,
    pub order: Vec<String>,
}
impl LaneGraphScene {
    pub fn validate(&self) -> Result<(), String> {
        if self.schema_version != VERSION || self.form != "laneGraph" {
            return Err("Unsupported lane scene version/form".into());
        }
        identity(&self.rule_set)?;
        revision(self.revision)?;
        self.view.validate()?;
        self.palette.validate()?;
        self.axis.validate()?;
        if self.lanes.len() > 128 {
            return Err("Lane graph lanes limit exceeded".into());
        }
        if self.steps.len() > 500 || self.order.len() != self.steps.len() {
            return Err("Lane graph steps/order limit or cardinality exceeded".into());
        }
        if self.spans.len() > 500 {
            return Err("Lane graph spans limit exceeded".into());
        }
        let mut ids = BTreeSet::new();
        let mut keys = BTreeSet::new();
        let mut containers = BTreeSet::new();
        let mut parts = 0;
        let mut add = |id: &str| -> Result<(), String> {
            identity(id)?;
            if !ids.insert(id.to_owned()) {
                return Err("Duplicate lane graph symbol/label identity".into());
            }
            Ok(())
        };
        let actions: BTreeSet<_> = self
            .palette
            .groups
            .iter()
            .flat_map(|g| &g.entries)
            .filter(|t| t.gesture == "action")
            .map(|t| t.id.as_str())
            .collect();
        let mut label = |value: &Label, owner: &Binding| -> Result<(), String> {
            value.validate()?;
            for part in &value.parts {
                if part
                    .binding
                    .as_ref()
                    .is_some_and(|b| b.context != owner.context)
                {
                    return Err("Lane label binding context mismatch".into());
                }
                if part
                    .edit_tool
                    .as_ref()
                    .is_some_and(|tool| !actions.contains(tool.as_str()))
                {
                    return Err("Lane label edit tool missing from action palette".into());
                }
            }
            parts += value.parts.len();
            if parts > 20000 {
                return Err("Lane graph label parts limit exceeded".into());
            }
            Ok(())
        };
        let mut lanes = BTreeMap::new();
        for (index, lane) in self.lanes.iter().enumerate() {
            add(&lane.id)?;
            identity(&lane.rule)?;
            identity(&lane.container)?;
            lane.binding.validate()?;
            if lane.binding.context != [lane.container.clone()]
                || lane.binding.key == lane.container
                || !keys.insert(&lane.binding.key)
            {
                return Err("Duplicate or incorrectly contextual lane binding".into());
            }
            containers.insert(&lane.container);
            label(&lane.label, &lane.binding)?;
            for part in &lane.label.parts {
                add(&part.id)?;
            }
            lanes.insert(lane.id.as_str(), (index, lane));
        }
        if containers.len() > 32 {
            return Err("Lane graph containers limit exceeded".into());
        }
        let mut steps = BTreeMap::new();
        for (index, step) in self.steps.iter().enumerate() {
            add(&step.id)?;
            identity(&step.rule)?;
            let (_, lane) = lanes.get(step.lane.as_str()).ok_or("Missing step lane")?;
            step.binding.validate()?;
            if step.binding.context != [lane.container.clone()]
                || step.binding.key == lane.container
                || !keys.insert(&step.binding.key)
            {
                return Err("Duplicate or incorrectly contextual step binding".into());
            }
            if step.rank >= self.steps.len() {
                return Err("Invalid lane step rank".into());
            }
            label(&step.label, &step.binding)?;
            for part in &step.label.parts {
                add(&part.id)?;
            }
            steps.insert(step.id.as_str(), (index, step));
        }
        let mut outgoing = vec![Vec::new(); self.steps.len()];
        let mut incoming = vec![0; self.steps.len()];
        let mut arcs = 0;
        for (index, step) in self.steps.iter().enumerate() {
            arcs += step.predecessors.len();
            if arcs > 4000 {
                return Err("Lane graph arcs limit exceeded".into());
            }
            let mut seen = BTreeSet::new();
            for parent in &step.predecessors {
                let (p, predecessor) = steps
                    .get(parent.as_str())
                    .ok_or("Missing lane predecessor")?;
                if *p == index
                    || !seen.insert(parent)
                    || predecessor.binding.context != step.binding.context
                {
                    return Err("Duplicate, self or cross-container lane predecessor".into());
                }
                outgoing[*p].push(index);
                incoming[index] += 1;
            }
        }
        let mut ready: BTreeSet<_> = incoming
            .iter()
            .enumerate()
            .filter_map(|(i, &count)| (count == 0).then_some(i))
            .collect();
        let mut unordered = vec![false; self.steps.len()];
        let mut rank = 0;
        while !ready.is_empty() {
            if ready.len() > 1 {
                for &i in &ready {
                    unordered[i] = true;
                }
            }
            let i = ready.pop_first().ok_or("Missing ready lane step")?;
            let step = &self.steps[i];
            if self.order.get(rank) != Some(&step.id) || step.rank != rank {
                return Err("Lane order/ranks differ from stable topological order".into());
            }
            rank += 1;
            for &next in &outgoing[i] {
                incoming[next] -= 1;
                if incoming[next] == 0 {
                    ready.insert(next);
                }
            }
        }
        if rank != self.steps.len() {
            return Err("Lane precedence cycle".into());
        }
        if self
            .steps
            .iter()
            .enumerate()
            .any(|(i, step)| step.unordered != unordered[i])
        {
            return Err("Incorrect unordered lane step marker".into());
        }
        let mut owners = BTreeSet::new();
        for span in &self.spans {
            add(&span.id)?;
            let (_, start) = steps.get(span.step.as_str()).ok_or("Missing span start")?;
            let (_, end) = steps.get(span.end.as_str()).ok_or("Missing span end")?;
            if !owners.insert(&span.step)
                || end.rank <= start.rank
                || start.binding.context != end.binding.context
                || span.lanes.is_empty()
                || !span.lanes.contains(&start.lane)
            {
                return Err("Invalid lane span endpoints/owner".into());
            }
            let mut previous = None;
            for id in &span.lanes {
                let (index, lane) = lanes.get(id.as_str()).ok_or("Missing span lane")?;
                if lane.binding.context != start.binding.context
                    || previous.is_some_and(|p| *index != p + 1)
                {
                    return Err(
                        "Lane span must cover distinct contiguous bands in semantic order".into(),
                    );
                }
                previous = Some(*index);
            }
        }
        if serde_json::to_vec(self).map_err(|e| e.to_string())?.len() > 8 * 1024 * 1024 {
            return Err("Lane encoded scene limit exceeded".into());
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LaneGraphRuleSet {
    pub schema_version: u32,
    pub projection: crate::ProjectionPolicy,
    pub id: String,
    pub label: String,
    pub language: String,
    pub form: String,
    pub lane_graph: LaneGraphRules,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LaneGraphRules {
    pub container: LaneContainerRule,
    pub lane: LaneRule,
    pub step: LaneStepRule,
    pub axis: SemanticAxis,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "graph::present"
    )]
    pub edit: Option<LabelEdit>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LaneContainerRule {
    #[serde(rename = "match")]
    pub class: String,
    pub lanes: String,
    pub steps: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LaneRule {
    pub id: String,
    pub label: LabelRule,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LaneStepRule {
    pub id: String,
    pub label: LabelRule,
    pub lane: String,
    pub after: String,
    pub end: String,
    pub across: String,
}
impl LaneGraphRuleSet {
    pub fn validate(&self) -> Result<(), String> {
        self.projection.validate(false)?;
        if self.schema_version != RULE_VERSION || self.form != "laneGraph" {
            return Err("Unsupported lane rule version/form".into());
        }
        let r = &self.lane_graph;
        for name in [
            &self.id,
            &self.label,
            &self.language,
            &r.container.class,
            &r.container.lanes,
            &r.container.steps,
            &r.lane.id,
            &r.step.id,
            &r.step.lane,
            &r.step.after,
            &r.step.end,
            &r.step.across,
        ] {
            identity(name)?;
        }
        if r.lane.id == r.step.id {
            return Err("Duplicate lane/step rule identity".into());
        }
        r.axis.validate()?;
        r.lane.label.validate()?;
        r.step.label.validate()?;
        if let Some(edit) = &r.edit {
            for name in [&edit.tool, &edit.command, &edit.accepts] {
                identity(name)?;
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LaneTargetResponse {
    pub revision: u64,
    pub view_key: String,
    pub tool_id: String,
    pub step: String,
    pub lane: String,
    #[serde(deserialize_with = "graph::nullable")]
    pub before: Option<String>,
    #[serde(deserialize_with = "graph::nullable")]
    pub end: Option<String>,
    pub enabled: bool,
    pub reason: String,
}
impl LaneTargetResponse {
    pub fn validate(&self) -> Result<(), String> {
        revision(self.revision)?;
        for id in [&self.view_key, &self.tool_id, &self.step, &self.lane] {
            identity(id)?;
        }
        for id in self.before.iter().chain(self.end.iter()) {
            identity(id)?;
        }
        if self.before.as_ref() == Some(&self.step) || self.end.as_ref() == Some(&self.step) {
            return Err("Lane target cannot name itself as gap or end".into());
        }
        if !self.enabled && self.reason.is_empty() {
            return Err("Disabled lane target requires a reason".into());
        }
        Ok(())
    }
}
