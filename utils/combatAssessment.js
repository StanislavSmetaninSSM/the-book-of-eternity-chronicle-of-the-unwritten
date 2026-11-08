/**
 * What a fight looks like, read back from the state.
 *
 * The game master decides every blow; the interface stores the result. That leaves the client
 * one honest job: check that what it was told to store can be true. Health cannot be above the
 * maximum declared for the same body, a group cannot list more bodies than it has health
 * entries for, and the arithmetic the rules require to be logged has to add up. Those are not
 * judgement calls, so the panel states them plainly and keeps silent about everything else -
 * an invented accusation about a fictional character is worse than no summary at all.
 */

/** A value written as `55`, `55.5` or `"55%"` - the three shapes health arrives in. */
const parsePercent = (value) => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string') return null;
    const match = value.trim().match(/^(-?\d+(?:\.\d+)?)\s*%?$/);
    return match ? Number(match[1]) : null;
};

const countWounds = (wounds) => (Array.isArray(wounds)
    ? wounds.filter(wound => wound && (!wound.healingState || wound.healingState.currentState !== 'Healed')).length
    : 0);

const countEffects = (character) => {
    if (!character) return 0;
    return [character.activePlayerEffects, character.activeEffects, character.activeBuffs, character.activeDebuffs]
        .reduce((sum, list) => sum + (Array.isArray(list) ? list.length : 0), 0);
};

/**
 * Reads one arithmetic expression: the four operations, parentheses and the five functions the
 * rulebook uses (round, floor, ceil, min, max). Units such as `kg` or `%` are dropped, because
 * the logged claim keeps them. Anything the reader cannot follow yields null, which the caller
 * treats as "not audited", never as "wrong".
 * @param {string} text
 * @returns {number|null}
 */
export function evaluateArithmetic(text) {
    if (typeof text !== 'string') return null;
    const source = String(text).replace(/[\u00A0\u2009\u202F]/g, ' ').replace(/[−–—]/g, '-');
    let at = 0;

    const skipSpace = () => { while (at < source.length && /\s/.test(source[at])) at += 1; };
    const atEnd = () => { skipSpace(); return at >= source.length; };

    const sum = () => {
        let value = product();
        for (;;) {
            skipSpace();
            const operator = source[at];
            if (operator !== '+' && operator !== '-') return value;
            at += 1;
            const right = product();
            if (right === null) return null;
            value = operator === '+' ? value + right : value - right;
        }
    };

    const product = () => {
        let value = atom();
        for (;;) {
            skipSpace();
            const operator = source[at];
            if (operator !== '*' && operator !== '/' && operator !== '×' && operator !== '÷') return value;
            at += 1;
            const right = atom();
            if (right === null) return null;
            if (operator === '/' || operator === '÷') {
                if (right === 0) return null;
                value /= right;
            } else value *= right;
        }
    };

    const atom = () => {
        skipSpace();
        if (source[at] === '-') { at += 1; const value = atom(); return value === null ? null : -value; }
        const call = source.slice(at).match(/^(round|floor|ceil|min|max)\s*\(/i);
        if (call) {
            at += call[0].length;
            const args = [];
            for (;;) {
                const argument = sum();
                if (argument === null) return null;
                args.push(argument);
                skipSpace();
                if (source[at] === ',') { at += 1; continue; }
                if (source[at] !== ')') return null;
                at += 1;
                break;
            }
            switch (call[1].toLowerCase()) {
                case 'round': return Math.round(args[0]);
                case 'floor': return Math.floor(args[0]);
                case 'ceil': return Math.ceil(args[0]);
                case 'min': return Math.min(...args);
                default: return Math.max(...args);
            }
        }
        if (source[at] === '(') {
            at += 1;
            const value = sum();
            if (value === null) return null;
            skipSpace();
            if (source[at] !== ')') return null;
            at += 1;
            return value;
        }
        const digits = source.slice(at).match(/^\d+(?:\.\d+)?/);
        if (!digits) return null;
        at += digits[0].length;
        return Number(digits[0]);
    };

    const value = sum();
    return value === null || !atEnd() ? null : value;
}

/**
 * Joins English digit groups: `13,500` is one number, while the comma in `min(20, max(1, 5))`
 * separates arguments. Only a group of exactly three digits after the comma counts.
 */
const joinThousands = (text) => String(text).replace(/(\d),(?=\d{3}(?!\d))/g, '$1');

/**
 * The arithmetic a logged line is claiming, stripped of everything that is not part of it.
 * Lines here are `Label: expression = result`, so the label goes with the last colon; what
 * remains must be numbers, the four operations, parentheses and nothing else. A letter or a
 * missing operator means this is a definition, a comparison or prose, and it is left alone.
 */
const cleanExpression = (text) => {
    let expression = joinThousands(text);
    const colon = expression.lastIndexOf(':');
    if (colon !== -1) expression = expression.slice(colon + 1);
    expression = expression
        .replace(/\bround\b|\bfloor\b|\bceil\b|\bmin\b|\bmax\b/gi, match => match)
        .replace(/[\u00A0\u2009\u202F]/g, ' ')
        .replace(/\s*[%\u2070]\s*/g, ' ')
        .replace(/kg|кг/gi, ' ')
        .replace(/\b(?:points?|units?)\b/gi, ' ')
        .replace(/[×✕]/g, '*')
        .replace(/÷/g, '/')
        .replace(/^\s*[-+*•]+\s*/, '')
        .trim();
    if (/[A-Za-zА-Яа-яЁё\u0400-\u04FF']/.test(expression.replace(/\b(round|floor|ceil|min|max)\b/gi, ''))) return null;
    if (!/[+\-*/]/.test(expression)) return null;
    return expression;
};

/** The number a claim ends with: `45`, `45%`, `55kg.`, nothing else after it. */
const parseClaim = (text) => {
    const trimmed = String(text).trim().replace(/\s*\([^)]*\)\s*$/, '').replace(/[.,;:]+$/, '');
    const match = trimmed.match(/^(-?\d+(?:\.\d+)?)\s*(?:%|kg|кг)?$/i);
    return match ? { value: Number(match[1]), exact: match[1].includes('.') } : null;
};

/**
 * Re-checks the lines the game master must log for every calculation it performs. A line is
 * audited only when it reads `expression = number` (a label before the expression is allowed,
 * as in "Kaelen's criticalWeight = 50 + 15 = 65kg"), and only when both sides are readable:
 * a whole number is tolerated up to the rounding the rules ask for, a decimal one up to half a
 * percent. Anything else is passed over in silence - the panel reports a slip, never a hunch.
 * @param {string[]} lines
 */
export function auditCalculationLines(lines) {
    const failures = [];
    let checked = 0;
    (Array.isArray(lines) ? lines : []).forEach((entry, order) => {
        if (typeof entry !== 'string' || !entry.includes('=')) return;
        const line = entry.trim();
        if (/[[\]{}]/.test(line) || /[<>]=|==|!=|=>/.test(line)) return;
        const parts = line.split('=');
        const claim = parseClaim(parts[parts.length - 1]);
        if (!claim) return;
        const expression = cleanExpression(parts.length > 2 ? parts[parts.length - 2] : parts[0]);
        if (expression === null) return;
        const computed = evaluateArithmetic(expression);
        if (computed === null) return;
        checked += 1;
        const tolerance = claim.exact ? Math.max(0.01, Math.abs(claim.value) * 0.005) : 0.5;
        if (Math.abs(computed - claim.value) > tolerance) {
            failures.push({ line, kind: 'equality', order, claimed: claim.value, computed: Math.round(computed * 100) / 100 });
        }
    });
    return { checked, failures };
}

/**
 * The verdict a line states about its own comparison. Labelled ("RESULT: TRUE", "Status: FALSE"),
 * asked ("Is 6 <= 0? FALSE"), or, failing both, the first standalone TRUE or FALSE after the
 * comparison. A line that only shows a threshold - and the rulebook is full of them - states no
 * verdict about a number, so it is passed over.
 * @param {string} text
 */
function parseVerdict(text) {
    const labelled = /\b(?:result|status|итог|результат)\b\s*[:=]?\s*["']?(true|false)\b/i.exec(text);
    if (labelled) return { value: labelled[1].toLowerCase() === 'true', index: labelled.index };
    const asked = /(?:\?|:)\s*["']?(true|false)\b\s*[.)]?\s*$/i.exec(text);
    if (asked) return { value: asked[1].toLowerCase() === 'true', index: asked.index };
    const stated = /\b(true|false)\b(?!\w)/i.exec(text);
    return stated ? { value: stated[1].toLowerCase() === 'true', index: stated.index } : null;
}

/**
 * The comparisons stated in a stretch of text. `>>` and `<<` belong to markup, not to arithmetic,
 * and `≥`/`≤` are the same two relations written another way.
 * @param {string} text
 */
function comparisonsIn(text) {
    const found = [];
    const pattern = /(>=|<=|≥|≤|>|<)/g;
    let match = pattern.exec(text);
    while (match !== null) {
        const token = match[1];
        const index = match.index;
        const doubled = (token === '>' || token === '<') && (text[index - 1] === token || text[index + 1] === token);
        if (!doubled) {
            found.push({ token: token === '≥' ? '>=' : token === '≤' ? '<=' : token, index, length: token.length });
        }
        match = pattern.exec(text);
    }
    return found;
}

/**
 * One side of a comparison: a bare number keeping its unit (`55kg`), or arithmetic. Quotes,
 * markdown emphasis, a label and trailing punctuation are stripped; prose, a placeholder in
 * brackets or a name in the way yield null, which skips the line instead of inventing a claim.
 * @param {string} text
 */
function readOperand(text) {
    let region = joinThousands(text)
        .replace(/[*"'`“”«»]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const colon = region.lastIndexOf(':');
    if (colon !== -1) region = region.slice(colon + 1).trim();
    if (region.startsWith('(') && !region.includes(')')) region = region.slice(1).trim();
    if (region.endsWith(')') && !region.includes('(')) region = region.slice(0, -1).trim();
    region = region.replace(/^[.,;:\s]+/, '').replace(/[.,;:\s]+$/, '');
    if (!region) return null;
    const bare = /^(-?\d+(?:\.\d+)?)\s*(?:%|kg|кг)?$/i.exec(region);
    if (bare) return Number(bare[1]);
    const expression = cleanExpression(region);
    if (expression === null) return null;
    const value = evaluateArithmetic(expression);
    return Number.isFinite(value) ? value : null;
}

const RELATION = {
    '>=': (left, right) => left >= right,
    '<=': (left, right) => left <= right,
    '>': (left, right) => left > right,
    '<': (left, right) => left < right,
};

/**
 * Re-checks the verdicts of a turn: the lines that compare two quantities and then state whether
 * the comparison holds, as the rules require of a threshold check ("Step 5 (Threshold Check):
 * 21 <= 10. RESULT: FALSE."). Whether the armor holds, whether a level went up, whether a pack
 * fits under the ceiling - these are the decisions a fight is made of, and they are the arithmetic
 * a model most often writes one step away from the truth. A line is audited only when it carries
 * exactly one comparison, both sides read as numbers and a verdict is stated on the same line; the
 * verdict is then measured against what the numbers say. Nothing is corrected here either: an
 * outcome the rules hand to judgement stays the game master's, and only its arithmetic is checked.
 * @param {string[]} lines
 */
export function auditComparisonLines(lines) {
    const failures = [];
    let checked = 0;
    (Array.isArray(lines) ? lines : []).forEach((entry, order) => {
        if (typeof entry !== 'string' || !/true|false/i.test(entry)) return;
        const line = entry.trim().replace(/^[-+•*]\s+/, '');
        const verdict = parseVerdict(line);
        if (!verdict) return;
        // Only the stretch before the verdict is read: the numbers to compare, and nothing that
        // the sentence goes on to say about them.
        const statement = line.slice(0, verdict.index);
        const comparisons = comparisonsIn(statement);
        if (comparisons.length !== 1) return;
        const [comparison] = comparisons;
        const left = readOperand(statement.slice(0, comparison.index));
        const right = readOperand(statement.slice(comparison.index + comparison.length));
        if (left === null || right === null) return;
        checked += 1;
        const holds = RELATION[comparison.token](left, right);
        if (holds !== verdict.value) {
            failures.push({
                line,
                kind: 'comparison',
                order,
                claimed: verdict.value ? 'TRUE' : 'FALSE',
                computed: holds ? 'TRUE' : 'FALSE',
            });
        }
    });
    return { checked, failures };
}

const rowFor = (combatant, side) => {
    // A group states its health per body instead of as one number, so its share is the average
    // of the rows the game master reported for it.
    const rows = (Array.isArray(combatant.healthStates) ? combatant.healthStates : []).map(parsePercent).filter(value => value !== null);
    const health = parsePercent(combatant.currentHealth)
        ?? (rows.length ? Math.round(rows.reduce((sum, value) => sum + value, 0) / rows.length) : null);
    const max = parsePercent(combatant.maxHealth);
    const issues = [];
    if (health !== null && max !== null && health > max) issues.push({ kind: 'health_above_max', health, max });
    const units = Array.isArray(combatant.healthStates) ? combatant.healthStates.length : null;
    const count = parsePercent(combatant.count);
    if (combatant.isGroup === true && units !== null && count !== null && units !== count) {
        issues.push({ kind: 'group_size_mismatch', units, count });
    }
    return {
        side,
        NPCId: combatant.NPCId || null,
        name: combatant.name,
        alive: combatant.isGroup === true ? count === null || count > 0 : health === null || health > 0,
        healthPercent: health !== null && max !== null && max > 0 ? Math.round((health / max) * 100) : null,
        wounds: countWounds(combatant.wounds),
        effects: countEffects(combatant),
        issues,
    };
};

/**
 * Aggregates one fight: who is still standing, how much of them is left, and what in the
 * numbers does not fit. Pass the combat lists, the named NPCs behind them (for wounds and
 * effects, which live on the character rather than on the combat object) and the calculation
 * lines of the turn.
 * @param {{ enemies?: object[], allies?: object[], npcs?: object[], player?: object|null, calculationLines?: string[] }} input
 */
export function assessCombat({ enemies = [], allies = [], npcs = [], player = null, calculationLines = [] } = {}) {
    const characters = Array.isArray(npcs) ? npcs : [];
    const rows = [...enemies, ...allies].map(combatant => {
        if (!combatant || typeof combatant !== 'object') return null;
        const row = rowFor(combatant, allies.indexOf(combatant) !== -1 ? 'ally' : 'enemy');
        const record = (combatant.NPCId && characters.find(npc => npc && npc.NPCId === combatant.NPCId))
            || characters.find(npc => npc && npc.name === combatant.name);
        if (record) {
            row.wounds = countWounds(record.wounds);
            row.effects = countEffects(record);
        }
        return row;
    }).filter(row => !!row);

    const seen = new Set();
    for (const row of rows) {
        const key = `${row.side}:${row.NPCId || row.name}`;
        if (seen.has(key)) row.issues.push({ kind: 'duplicate_participant' });
        else seen.add(key);
    }

    const sideOf = (side) => {
        const ofSide = rows.filter(row => row.side === side);
        const percents = ofSide.map(row => row.healthPercent).filter(value => value !== null);
        return {
            total: ofSide.length,
            standing: ofSide.filter(row => row.alive).length,
            wounds: ofSide.reduce((sum, row) => sum + row.wounds, 0),
            effects: ofSide.reduce((sum, row) => sum + row.effects, 0),
            healthPercent: percents.length ? Math.round(percents.reduce((sum, value) => sum + value, 0) / percents.length) : null,
        };
    };

    const equality = auditCalculationLines(calculationLines);
    const verdicts = auditComparisonLines(calculationLines);
    const calculations = {
        checked: equality.checked + verdicts.checked,
        // Kept in log order, so a verdict that contradicts its own numbers is reported before a
        // sum written further down, whatever order the two readers found them in.
        failures: [...equality.failures, ...verdicts.failures].sort((a, b) => a.order - b.order),
    };

    return {
        rows,
        enemies: sideOf('enemy'),
        allies: sideOf('ally'),
        player: player ? {
            healthPercent: parsePercent(player.currentHealth) !== null && parsePercent(player.maxHealth) > 0
                ? Math.round((parsePercent(player.currentHealth) / parsePercent(player.maxHealth)) * 100)
                : null,
            wounds: countWounds(player.wounds),
            effects: countEffects(player),
            overloaded: player.isOverloaded === true,
        } : null,
        issues: rows.flatMap(row => row.issues.map(issue => ({ ...issue, subject: row.name }))),
        calculations,
    };
}
