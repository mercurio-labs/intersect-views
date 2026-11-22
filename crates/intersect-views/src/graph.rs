//! M8 graph labels and partition contracts. No model or UI dependency.
use super::*;
use std::collections::BTreeSet;
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Label {
    pub parts: Vec<LabelPart>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LabelPart {
    pub id: String,
    pub text: String,
    #[serde(deserialize_with = "nullable")]
    pub binding: Option<Binding>,
    #[serde(deserialize_with = "required_nullable_string")]
    pub edit_tool: Option<String>,
}
pub(crate) fn nullable<'de, D: serde::Deserializer<'de>, T: Deserialize<'de>>(
    d: D,
) -> Result<Option<T>, D::Error> {
    Option::<T>::deserialize(d)
}
pub(crate) fn present<'de, D: serde::Deserializer<'de>, T: Deserialize<'de>>(
    d: D,
) -> Result<Option<T>, D::Error> {
    T::deserialize(d).map(Some)
}
impl Label {
    pub fn text(&self) -> String {
        self.parts.iter().map(|p| p.text.as_str()).collect()
    }
    pub fn validate(&self) -> Result<(), String> {
        if self.parts.len() > 32 {
            return Err("Graph label parts limit exceeded".into());
        }
        let mut ids = BTreeSet::new();
        let mut len = 0;
        for p in &self.parts {
            identity(&p.id)?;
            if !ids.insert(&p.id) {
                return Err("Duplicate label part identity".into());
            }
            label_text(&p.text)?;
            len += p.text.len();
            if let Some(b) = &p.binding {
                b.validate()?;
            }
            if let Some(tool) = &p.edit_tool {
                identity(tool)?;
                if p.binding.is_none() {
                    return Err("Unbound label part cannot be edited".into());
                }
            }
        }
        if len > 4096 {
            return Err("Graph label text limit exceeded".into());
        }
        Ok(())
    }
}
impl PartialEq<&str> for Label {
    fn eq(&self, s: &&str) -> bool {
        self.text() == *s
    }
}
impl std::fmt::Display for Label {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.text())
    }
}
pub fn label_text(text: &str) -> Result<(), String> {
    if text.len() > 4096 {
        return Err("Graph label text limit exceeded".into());
    }
    if text.contains(['\r', '\n', '\t']) {
        return Err("Graph label unsupported multiline text".into());
    }
    Ok(())
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RegionSet {
    pub direction: String,
    pub items: Vec<Region>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Region {
    pub id: String,
    pub rule: String,
    pub label: Label,
    pub binding: Binding,
    pub collapsed: bool,
    pub children: Vec<Node>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(untagged)]
pub enum LabelRule {
    Scalar(Slot),
    Parts(PartsRule),
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PartsRule {
    pub parts: Vec<PartRule>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PartRule {
    pub id: String,
    pub subject: Subject,
    pub text: Slot,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "present"
    )]
    pub when: Option<String>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "present"
    )]
    pub edit: Option<LabelEdit>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
pub enum Subject {
    #[serde(rename = "self")]
    This,
    Select {
        select: String,
    },
    None,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LabelEdit {
    pub tool: String,
    pub command: String,
    pub accepts: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RegionRule {
    pub id: String,
    pub select: String,
    pub label: LabelRule,
    pub children: SelectRule,
    pub direction: String,
}
impl LabelRule {
    pub fn validate(&self) -> Result<(), String> {
        fn slot(s: &Slot) -> Result<(), String> {
            s.validate()?;
            if let Slot::Text { text } = s {
                label_text(text)?;
            }
            Ok(())
        }
        match self {
            Self::Scalar(s) => slot(s),
            Self::Parts(r) => {
                if r.parts.len() > 32 {
                    return Err("Graph label parts limit exceeded".into());
                }
                let mut ids = BTreeSet::new();
                for p in &r.parts {
                    identity(&p.id)?;
                    if p.id.starts_with("__") || !ids.insert(&p.id) {
                        return Err("Duplicate/reserved label part ID".into());
                    }
                    slot(&p.text)?;
                    if matches!(p.text, Slot::SourceText { .. }) && p.edit.is_some() {
                        return Err("Stored source text is a read-only display slot".into());
                    }
                    if let Some(w) = &p.when {
                        identity(w)?;
                    }
                    if let Subject::Select { select } = &p.subject {
                        identity(select)?;
                    }
                    if matches!(p.subject, Subject::None)
                        && (!matches!(p.text, Slot::Text { .. }) || p.edit.is_some())
                    {
                        return Err("Unbound parts require literal text and no edit".into());
                    }
                    if let Some(e) = &p.edit {
                        for s in [&e.tool, &e.command, &e.accepts] {
                            identity(s)?;
                        }
                    }
                }
                Ok(())
            }
        }
    }
    pub fn edits(&self) -> Vec<&LabelEdit> {
        match self {
            Self::Parts(r) => r.parts.iter().filter_map(|p| p.edit.as_ref()).collect(),
            Self::Scalar(_) => vec![],
        }
    }
}
impl GraphRuleSet {
    pub fn label_rules(&self) -> Vec<&LabelRule> {
        let mut result = vec![];
        for r in &self.symbols {
            result.extend(
                [r.title.as_ref(), r.subtitle.as_ref(), r.label.as_ref()]
                    .into_iter()
                    .flatten(),
            );
            result.extend(r.compartments.iter().map(|c| &c.row_label));
            if let Some(region) = &r.regions {
                result.push(&region.label);
            }
        }
        for e in &self.edges {
            let (EdgeRule::Element { label, .. } | EdgeRule::Reference { label, .. }) = e;
            result.push(label);
        }
        result
    }
    pub fn label_edits(&self) -> Vec<&LabelEdit> {
        self.label_rules()
            .into_iter()
            .flat_map(LabelRule::edits)
            .collect()
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LabelTargetResponse {
    pub revision: u64,
    pub view_key: String,
    pub tool_id: String,
    pub part: String,
    pub enabled: bool,
    pub reason: String,
}
impl LabelTargetResponse {
    pub fn validate(&self) -> Result<(), String> {
        revision(self.revision)?;
        for s in [&self.view_key, &self.tool_id, &self.part] {
            identity(s)?;
        }
        if !self.enabled && self.reason.is_empty() {
            return Err("Disabled label action requires a reason".into());
        }
        Ok(())
    }
}
