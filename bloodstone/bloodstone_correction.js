(async () => {
  const token = canvas.tokens.controlled[0];
  if (!token) return ui.notifications.warn("🩸 Select a token first.");
  const actor = token.actor;

  // Find the Blood Stone modifier
  const mods = [...actor.system.customModifiers.hp];
  const idx  = mods.findIndex(m => m.label === "Blood Stone");
  if (idx < 0) return ui.notifications.warn("🩸 No Blood Stone modifier found.");

  // Ask for the new total HP loss
  const { value: input } = await new Promise(resolve => {
    new Dialog({
      title: "Adjust Blood Stone Loss",
      content: `<form>
        <div class="form-group">
          <label>New total HP loss (enter a positive number):</label>
          <input id="amount" type="number" min="0" value="${-mods[idx].modifier}" />
        </div>
      </form>`,
      buttons: {
        ok:     { label: "Save", callback: html => resolve({ value: Number(html.find("#amount").val()) }) },
        cancel: { label: "Cancel", callback: () => resolve({ value: null }) }
      },
      default: "ok"
    }).render(true);
  });
  if (input === null || isNaN(input)) return;

  // Update the modifier and clamp current HP
  mods[idx].modifier = -Math.abs(input);
  // Build a single update for both customModifiers.hp and, if needed, current HP
  const newMax = actor.system.attributes.hp.max + mods[idx].modifier - actor.system.customModifiers.hp[idx].modifier;
  let newCur = actor.system.attributes.hp.value;
  if (newCur > newMax) newCur = newMax;

  await actor.update({
    "system.customModifiers.hp": mods,
    "system.attributes.hp.value": newCur
  });

  ui.notifications.info(`🩸 Blood Stone permanent loss set to ${input} HP.`);
})();