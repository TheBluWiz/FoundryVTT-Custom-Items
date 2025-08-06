(async () => {
  /* ── 1. ENSURE TOKEN & BLOOD-STONE ITEM ───────────────────── */
  const token = canvas.tokens.controlled[0];
  if (!token) return ui.notifications.warn("🩸 Select a token first.");
  const actor = token.actor;

  // Item-Macro provides `item`; fall back to first Blood Stone if needed
  const stone = (typeof item !== "undefined")
    ? item
    : actor.items.find(i => i.name === "Blood Stone");
  if (!stone) return ui.notifications.warn("🩸 No Blood Stone found on this actor.");

  /* ── 2. SPELL SELECTION ──────────────────────────────────── */
  const spells = actor.items.filter(s => s.type === "spell" && s.system.level.value >= 1);
  if (!spells.length) return ui.notifications.warn("📜 Actor has no 1st-level+ spells.");

  const spellId = await new Promise(resolve => {
    new Dialog({
      title: "Blood Stone — Select Spell",
      content: `<form><div class="form-group">
                 <label>Spell:</label>
                 <select id="spell">
                   ${spells.map(
                     s => `<option value="${s.id}">${s.name} (lvl ${s.system.level.value})</option>`
                   ).join("")}
                 </select></div></form>`,
      buttons: {
        ok:     { label: "Activate", callback: html => resolve(html.find("#spell").val()) },
        cancel: { label: "Cancel",   callback: ()   => resolve(null) }
      },
      default: "ok"
    }).render(true);
  });
  if (!spellId) return;                                // cancelled

  const spell  = actor.items.get(spellId);
  const oldLvl = spell.system.level.value;
  const newLvl = Math.min(oldLvl + 1, 10);

  ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ token }),
    content: `🩸 <em>Blood Stone</em> heightens <strong>${spell.name}</strong> from ${oldLvl} → ${newLvl}.`
  });
  spell.toMessage(undefined, { create: true });        // quick cast card (non-blocking)

  /* ── 3. FORTITUDE SAVE (DC 25) ───────────────────────────── */
  const fort = actor.getStatistic?.("fortitude");
  if (!fort?.roll) { ui.notifications.error("No Fortitude save on this actor."); return; }
  const roll   = await fort.roll({ dc: 25 });
  const degree = Number(roll.degreeOfSuccess ?? -1);   // 3,2,1,0

  /* ── 4. DETERMINE PERMANENT HP LOSS ─────────────────────── */
  let loss = 0; let chatMsg = "";
  switch (degree) {
    case 3: chatMsg = "🛡️ <b>Critical Success</b>: No ill effect."; break;
    case 2: loss = 1;             chatMsg = "✅ <b>Success</b>: Lose 1 permanent HP."; break;
    case 1: loss = actor.level;   chatMsg = `❌ <b>Failure</b>: Lose ${loss} permanent HP.`; break;
    case 0: loss = actor.level*2; chatMsg = `💀 <b>Critical Failure</b>: Lose ${loss} permanent HP.`; break;
    default: ui.notifications.error("Unexpected save result."); return;
  }
  ChatMessage.create({ speaker: ChatMessage.getSpeaker({ token }), content: chatMsg });
  ui.notifications.info(chatMsg.replace(/<[^>]*>/g,""));   // plain text

  /* ── 5. ADD / UPDATE “Blood Stone” MAX-HP MODIFIER & CUR HP ─ */
  if (loss > 0) {
    // 5a. custom modifier (hp domain)
    const modPath = "system.customModifiers.hp";
    const mods    = foundry.utils.duplicate(actor.system.customModifiers?.hp ?? []);
    const idx     = mods.findIndex(m => m.label === "Blood Stone");
    if (idx >= 0) mods[idx].modifier -= loss;          // cumulative
    else mods.push({
      label: "Blood Stone",
      modifier: -loss,
      type: "untyped",
      enabled: true,
      predicate: []
    });
    await actor.update({ [modPath]: mods });

    // 5b. reduce CURRENT HP by same loss, but never below 0 or above new max
    const newMax = actor.system.attributes.hp.max;     // recalculated after modifier update
    const newCur = Math.max(0, Math.min(actor.system.attributes.hp.value - loss, newMax));
    if (newCur !== actor.system.attributes.hp.value) {
      await actor.update({ "system.attributes.hp.value": newCur });
    }

    /* ── 6. PER-STONE DRAIN COUNTER WITH INITIAL SEED ────── */
    let drained = await stone.getFlag("world","hpDrained");
    if (!Number.isInteger(drained) || drained === 0) {
      drained = Math.floor(Math.random()*55) + 6;      // 6–60 seed
      ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ token }),
        content: `🔮 <em>Blood Stone</em> already hums with ${drained} stolen HP…`
      });
    }
    drained += loss;
    await stone.setFlag("world","hpDrained", drained);

    ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ token }),
      content: `<em>Blood Stone</em> drains ${loss} HP (Stone total ${drained}/100).`
    });

    /* ── 7. DEMONIC AWAKENING FOR THIS STONE ONLY ───────── */
    if (drained >= 100) {
      ui.notifications.error("⚠️ The Blood Stone cracks — a blood demon emerges!");
      const demon =
        game.actors.getName("Kalavakus Demon") || game.actors.getName("Blood Demon");
      if (demon) await demon.spawnAt({ x: token.x + 100, y: token.y });
      await actor.deleteEmbeddedDocuments("Item",[stone.id]);   // crumble this stone
    }
  }
})();