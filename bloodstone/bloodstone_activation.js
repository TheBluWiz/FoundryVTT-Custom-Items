(async () => {
  /* ── CONSTANTS ───────────────────────────────────────────── */
  const SAVE_DC            = 25;
  const STONE_LABEL        = "Blood Stone";
  const INITIAL_DRAIN_MIN  = 6;
  const INITIAL_DRAIN_MAX  = 60;

  /* ── SETUP ───────────────────────────────────────────────── */
  const token = canvas.tokens.controlled[0];
  if (!token) return ui.notifications.warn(`🩸 Select a token first.`);
  const actor   = token.actor;
  const speaker = ChatMessage.getSpeaker({ token });

  const stone = (typeof item !== "undefined")
    ? item
    : actor.items.find(i => i.name === STONE_LABEL);
  if (!stone) return ui.notifications.warn(`🩸 No ${STONE_LABEL} found on this actor.`);

  /* ── CACHE DEEP PROPERTIES ───────────────────────────────── */
  const hp    = actor.system.attributes.hp;
  let { value: curHP, max: maxHP } = hp;
  let mods = foundry.utils.duplicate(actor.system.customModifiers?.hp ?? []);

  /* ── HELPERS ─────────────────────────────────────────────── */
  /**
   * Post a chat message and matching notification.
   * @param {string} html - HTML content for chat.
   */
  const postMessage = html => {
    ChatMessage.create({ speaker, content: html });
    ui.notifications.info(html.replace(/<[^>]*>/g, ""));
  };

  /**
   * Initialize or increment the stone’s drained HP counter.
   * Commented-out chat line shows seed; enable if troubleshooting is needed.
   * @param {number} amount - HP to add.
   * @returns {Promise<number>} New total drained HP.
   */
  async function updateDrain(amount) {
    let drained = await stone.getFlag("world", "hpDrained") ?? 0;
    if (!Number.isInteger(drained) || drained === 0) {
      drained = Math.floor(Math.random() * (INITIAL_DRAIN_MAX - INITIAL_DRAIN_MIN + 1)) + INITIAL_DRAIN_MIN;
      // // Uncomment next line to display initial seed for troubleshooting:
      // // postMessage(`🔮 <em>${STONE_LABEL}</em> seeded with ${drained} stolen HP…`);
    }
    drained += amount;
    await stone.setFlag("world", "hpDrained", drained);
    postMessage(`<em>${STONE_LABEL}</em> drains ${amount} HP (Stone total ${drained}/100).`);
    return drained;
  }

  /* ── SPELL SELECTION ─────────────────────────────────────── */
  const spells = actor.items.filter(s => s.type === "spell" && s.system.level.value >= 1);
  if (!spells.length) return ui.notifications.warn(`📜 Actor has no 1st-level+ spells.`);

  const spellId = await new Promise(resolve => {
    new Dialog({
      title: `${STONE_LABEL} — Select Spell`,
      content: `<form><div class="form-group">
                  <label>Spell:</label>
                  <select id="spell">
                    ${spells.map(s => `<option value="${s.id}">${s.name} (lvl ${s.system.level.value})</option>`).join("")}
                  </select>
                </div></form>`,
      buttons: {
        ok:     { label: "Activate", callback: html => resolve(html.find("#spell").val()) },
        cancel: { label: "Cancel",   callback: ()   => resolve(null) }
      },
      default: "ok"
    }).render(true);
  });
  if (!spellId) return;

  const spell  = actor.items.get(spellId);
  const oldLvl = spell.system.level.value;
  const newLvl = Math.min(oldLvl + 1, 10);

  postMessage(`🩸 <em>${STONE_LABEL}</em> heightens <strong>${spell.name}</strong> from ${oldLvl} → ${newLvl}.`);
  spell.toMessage(undefined, { create: true });

  /* ── FORTITUDE SAVE (DC 25) ─────────────────────────────── */
  const fort = actor.getStatistic?.("fortitude");
  if (!fort?.roll) return ui.notifications.error(`⚠️ No Fortitude save on this actor.`);
  const roll   = await fort.roll({ dc: SAVE_DC });
  const degree = Number(roll.degreeOfSuccess ?? -1);

  /* ── CALCULATE EFFECTS ───────────────────────────────────── */
  let permLoss = 0, damage = 0, message = "";
  switch (degree) {
    case 3:
      permLoss = 1;
      message  = "🛡️ <b>Critical Success</b>: Lose 1 permanent HP.";
      break;
    case 2:
      permLoss = 1; damage = 1;
      message  = "✅ <b>Success</b>: Lose 1 permanent HP and take 1 damage.";
      break;
    case 1:
      permLoss = actor.level; damage = actor.level;
      message  = `❌ <b>Failure</b>: Lose ${permLoss} permanent HP and take ${damage} damage.`;
      break;
    case 0:
      permLoss = actor.level * 2; damage = permLoss;
      message  = `💀 <b>Critical Failure</b>: Lose ${permLoss} permanent HP and take ${damage} damage.`;
      break;
    default:
      return ui.notifications.error(`⚠️ Unexpected save result.`);
  }

  postMessage(message);

  /* ── APPLY DAMAGE (IF ANY) ───────────────────────────────── */
  if (damage > 0) {
    curHP = Math.max(0, curHP - damage);
    await actor.update({ "system.attributes.hp.value": curHP });
    postMessage(`☠️ <strong>${actor.name}</strong> takes <strong>${damage}</strong> damage from the ${STONE_LABEL}.`);
  }

  /* ── APPLY PERMANENT HP LOSS & CLAMP ─────────────────────── */
  const idx = mods.findIndex(m => m.label === STONE_LABEL);
  if (idx >= 0) mods[idx].modifier -= permLoss;
  else mods.push({ label: STONE_LABEL, modifier: -permLoss, type: "untyped", enabled: true, predicate: [] });

  const newMax = maxHP - permLoss;
  const updateData = { "system.customModifiers.hp": mods };
  if (curHP > newMax) updateData["system.attributes.hp.value"] = newMax;
  await actor.update(updateData);

  /* ── UPDATE DRAIN COUNTER ────────────────────────────────── */
  const totalDrained = await updateDrain(permLoss);

  /* ── DEMONIC AWAKENING ───────────────────────────────────── */
  if (totalDrained >= 100) {
    ui.notifications.error(`⚠️ The ${STONE_LABEL} cracks — a blood demon emerges!`);
    const demon = game.actors.getName("Kalavakus Demon") || game.actors.getName("Blood Demon");
    if (demon) await demon.spawnAt({ x: token.x + 100, y: token.y });
    await actor.deleteEmbeddedDocuments("Item", [stone.id]);
  }
})();