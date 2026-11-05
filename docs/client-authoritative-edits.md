> **Historical / superseded:** Multiplayer was removed in favor of single-player gameplay. This document records the former implementation and is not a current design or implementation plan.

# Client gameplay edits: safety phase and follow-up

The detailed phased specification, numbered tasks and acceptance criteria are in
[client-authoritative-edits-spec.md](client-authoritative-edits-spec.md).

A host full sync replaces the client's game snapshot. Until a command protocol
exists, a client-only gameplay edit is not authoritative and may be lost on
that replacement. The first safety phase refuses client/spectator inventory,
history, world and other gameplay edits with an explicit warning. Host and
single-player edits remain available. Client presentation work (images and
cinema), networking and GM turn commits use separate internal setters.

This is a temporary functional restriction, not an implementation of remote
editing: the client cannot currently equip items through the host. The host UI
may not expose every action on another player's character. Do not assume that
asking the host to act is a complete substitute.

Next phases:

1. Audit all gameplay-changing operations and side effects, ownership and UI
   entry points. Distinguish local preferences from shared game settings.
2. Introduce explicit, versioned host-authoritative commands, starting with
   equipment. Check connection identity, character/item IDs, slot, ownership,
   host revision and turn/session state; reject ambiguous or malformed data.
3. Retain unconfirmed intent, prevent a turn from using it as committed state,
   deduplicate command IDs, handle uncertain delivery and acknowledge only the
   actual authoritative outcome. Never apply arbitrary callbacks on the host.
4. For conflicting host snapshots, preserve intent and expose an explicit
   resolution; do not silently overwrite or blindly merge inventory changes.
5. Extend the protocol to the remaining operations, including stable history
   identity or a strict history revision. Test real manager/React commit races,
   stale grants, duplicate and lost acknowledgements, reconnection, persistence,
   and real multi-peer browser sessions where available. Both peers must update.

The safety guard is not a security boundary against a modified client. Existing
turn-result and other network paths require separate validation and review.
