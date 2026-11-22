//! Bounded deterministic partial-order and span constraints for M9.
//! Integration into the lane scene follows the approved specification.
use crate::EngineError;
use std::collections::BTreeSet;

pub(crate) struct Order {
    pub steps: Vec<usize>,
    pub ranks: Vec<usize>,
    pub unordered: Vec<bool>,
}

pub(crate) fn order(
    predecessors: &[Vec<usize>],
    max_steps: usize,
    max_arcs: usize,
) -> Result<Order, EngineError> {
    let count = predecessors.len();
    if count > max_steps {
        return Err(EngineError::limit("lane steps"));
    }
    let mut outgoing = vec![Vec::new(); count];
    let mut incoming = vec![0; count];
    let mut arcs = 0usize;
    for (step, parents) in predecessors.iter().enumerate() {
        let mut seen = BTreeSet::new();
        for &parent in parents {
            if parent >= count {
                return Err(EngineError("Lane predecessor is not visible".into()));
            }
            if parent == step {
                return Err(EngineError("A lane step cannot precede itself".into()));
            }
            if !seen.insert(parent) {
                continue;
            }
            arcs = arcs
                .checked_add(1)
                .ok_or_else(|| EngineError::limit("lane arcs"))?;
            if arcs > max_arcs {
                return Err(EngineError::limit("lane arcs"));
            }
            incoming[step] += 1;
            outgoing[parent].push(step);
        }
    }
    let mut ready: BTreeSet<_> = incoming
        .iter()
        .enumerate()
        .filter_map(|(step, &n)| (n == 0).then_some(step))
        .collect();
    let mut steps = Vec::with_capacity(count);
    let mut ranks = vec![0; count];
    let mut unordered = vec![false; count];
    while !ready.is_empty() {
        if ready.len() > 1 {
            for &step in &ready {
                unordered[step] = true;
            }
        }
        let step = ready
            .pop_first()
            .ok_or_else(|| EngineError("Missing ready lane step".into()))?;
        ranks[step] = steps.len();
        steps.push(step);
        for &next in &outgoing[step] {
            incoming[next] -= 1;
            if incoming[next] == 0 {
                ready.insert(next);
            }
        }
    }
    if steps.len() != count {
        return Err(EngineError("Lane precedence cycle".into()));
    }
    Ok(Order {
        steps,
        ranks,
        unordered,
    })
}

pub(crate) fn span(
    start_rank: usize,
    end_rank: usize,
    lanes: &[usize],
    lane_count: usize,
) -> Result<Vec<usize>, EngineError> {
    if end_rank <= start_rank {
        return Err(EngineError("Lane span must end after its start".into()));
    }
    if lanes.is_empty() || lanes.iter().any(|&lane| lane >= lane_count) {
        return Err(EngineError("Lane span requires visible lanes".into()));
    }
    let mut canonical = lanes.to_vec();
    canonical.sort_unstable();
    if canonical.windows(2).any(|pair| pair[1] != pair[0] + 1) {
        return Err(EngineError(
            "Lane span coverage must be distinct and contiguous".into(),
        ));
    }
    Ok(canonical)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stable_ready_ties_mark_unchosen_steps_and_preserve_precedence() -> Result<(), EngineError> {
        // C becomes ready while B is still ready. C's earlier source position
        // wins the next tie; B still retains its original unordered marker.
        let actual = order(&[vec![], vec![0], vec![]], 500, 4000)?;
        assert_eq!(actual.steps, [0, 1, 2]);
        assert_eq!(actual.ranks, [0, 1, 2]);
        assert_eq!(actual.unordered, [true, true, true]);
        Ok(())
    }

    #[test]
    fn chain_duplicates_and_empty_order_are_deterministic() -> Result<(), EngineError> {
        let input = [vec![2, 2], vec![0], vec![]];
        let a = order(&input, 3, 2)?;
        let b = order(&input, 3, 2)?;
        assert_eq!(a.steps, [2, 0, 1]);
        assert_eq!(a.ranks, [1, 2, 0]);
        assert_eq!(a.unordered, [false; 3]);
        assert_eq!(a.steps, b.steps);
        assert!(order(&[], 0, 0)?.steps.is_empty());
        Ok(())
    }

    #[test]
    fn cycles_missing_predecessors_and_each_limit_fail() {
        for input in [vec![vec![1], vec![0]], vec![vec![0]], vec![vec![1]]] {
            assert!(order(&input, 500, 4000).is_err());
        }
        assert!(order(&[vec![]], 0, 4000).is_err());
        assert!(order(&[vec![], vec![0]], 500, 0).is_err());
    }

    #[test]
    fn spans_never_expand_to_cover_omitted_bands() -> Result<(), EngineError> {
        assert_eq!(span(0, 2, &[2, 1], 4)?, [1, 2]);
        assert_eq!(span(0, 1, &[3], 4)?, [3]);
        for lanes in [vec![], vec![0, 2], vec![1, 1], vec![4]] {
            assert!(span(0, 2, &lanes, 4).is_err());
        }
        assert!(span(2, 2, &[0], 1).is_err());
        assert!(span(2, 1, &[0], 1).is_err());
        Ok(())
    }
}
