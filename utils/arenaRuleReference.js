/** Build a verified reference for opted-in stages. Others keep their inline guides. */
export async function getNarrativeRuleReference(rules, narrative, signal, world, stepName = 'Step6_NarrativeGeneration_TaskGuide') {
  try {
    if (!globalThis.crypto?.subtle) return null;
    const response = await fetch('/__arena_gm/rules', { cache: 'no-store', signal });
    if (!response.ok) return null;
    const manifest = await response.json();
    const hash = async text => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), n => n.toString(16).padStart(2, '0')).join('');
    if (manifest.version !== 2 || !/^[a-f0-9]{64}$/.test(manifest.id) || typeof world !== 'string' ||
        manifest.hashes?.rules !== await hash(rules) || manifest.hashes?.narrative !== await hash(narrative) || manifest.hashes?.world !== await hash(world) || !/^[a-f0-9]{64}$/.test(manifest.hashes?.index || '') ||
        typeof manifest.files?.rules !== 'string' || typeof manifest.files?.narrative !== 'string' || typeof manifest.files?.world !== 'string' || typeof manifest.index !== 'string') return null;
    const focus = stepName === 'Step4_NPC_TaskGuide'
      ? `Read the world-logic guide at ${JSON.stringify(manifest.files.world)}. For NPC journals, memories and dialogue consult the narrative guide at ${JSON.stringify(manifest.files.narrative)}; use the index and relevant rules on NPCs, wounds, health, relationships, inventory and activities, including their cross-references. `
      : stepName === 'Step_FactionProgression_TaskGuide'
        ? `Read the complete world-logic guide at ${JSON.stringify(manifest.files.world)} and the narrative guide at ${JSON.stringify(manifest.files.narrative)}. Consult instruction blocks 21 and 30 using the index, the rules cited in the task and their cross-references, including 21.A.2.3, 21.A.3, 21.C.1, 21.C.4, 21.D, 21.F, 21.I and 30.1.D.0–D.2. Calculate elapsed cycles, economy, project resource audits and action results, territory, consequences and trackers from the supplied state. Preserve existing faction and project IDs, resources, earlier stage results and the output contract; do not invent unsupported outcomes. `
      : stepName === 'Step_WorldProgression_TaskGuide'
        ? `Read the complete world-logic guide at ${JSON.stringify(manifest.files.world)} and the narrative guide at ${JSON.stringify(manifest.files.narrative)}. Use the index to consult instruction blocks 19, 20, 21, 22, 23 and 30, the task's cited rules and their cross-references, especially 30.0, 30.1.A–C, 30.4.3, 30.6 and 30.8. Check elapsed time, threat actions, NPC travel and projects, and immediate consequences of all prior faction events in partiallyGeneratedResponse. Preserve established IDs, event history, trackers, stage output contract and existing results; do not invent unsupported outcomes. `
      : stepName === 'Step3_Combat_TaskGuide'
        ? `You are the combat auditor: use the index to read the combat data structures (instruction blocks 6, 15 and 28), damage, critical hits, resistances, effects, wound triggers and wound formats cited by the task (including Rules 5.20.2–5.20.3, 6.2 and 14.3), and follow their cross-references. Independently check the prior combat log and apply any required corrections. Preserve the established actor IDs, health scales, wound IDs and outcomes; never assume missing information. `
      : stepName === 'Step5_Inventory_TaskGuide'
        ? `Use the index to read the inventory, starting equipment, resource consumption, capacity, equipment, crafting and item rules relevant to this action, including every rule numbered in the task and its cross-references (particularly Rules 9.3, 10.1, 10.2, 10.3 and 10.6 when applicable). For sentient-item journals read the relevant literary guidance in ${JSON.stringify(manifest.files.narrative)}. Do not guess item IDs, counts, resources or outcomes. `
        : `Before writing, read and follow the complete narrative guide at ${JSON.stringify(manifest.files.narrative)}; use the index to locate the rules needed for this scene and follow cross-references. `;
    const prompt = `\n<LocalRuleReference version="2" sha256="${manifest.id}">\n` +
      `Mandatory: verify files with SHA-256 (rules: ${manifest.hashes.rules}; narrative: ${manifest.hashes.narrative}; world: ${manifest.hashes.world}; index: ${manifest.hashes.index}). ` +
      `Rules: ${JSON.stringify(manifest.files.rules)}; narrative: ${JSON.stringify(manifest.files.narrative)}; world: ${JSON.stringify(manifest.files.world)}; index: ${JSON.stringify(manifest.index)}. ` + focus +
      `These files contain the same authoritative guides normally included in the prompt. Preserve the current stage's output contract and use CurrentGameContext for all current values. ` +
      `If a file is missing or a hash mismatches, do not guess: reply using the normal envelope with output exactly {"_arenaRuleBundleUnavailable":true}; the game will retry this stage with the full guides.\n</LocalRuleReference>\n`;
    return { id: manifest.id, prompt };
  } catch (error) {
    if (signal?.aborted) throw error;
    return null;
  }
}
