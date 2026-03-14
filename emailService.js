// src/services/emailService.js
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST,
  port:   parseInt(process.env.SMTP_PORT),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// ── Styles communs ──────────────────────────────────────────────────
const baseStyle = `
  font-family: 'Segoe UI', Arial, sans-serif;
  background: #0a0d14;
  color: #e2e8f0;
  max-width: 600px;
  margin: 0 auto;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid #1e2740;
`;
const headerStyle = `background:#111520;padding:28px 32px;border-bottom:2px solid #3b82f6;`;
const bodyStyle   = `padding:28px 32px;background:#111520;`;
const footerStyle = `background:#0a0d14;padding:16px 32px;text-align:center;font-size:12px;color:#475569;border-top:1px solid #1e2740;`;
const badgeStyle  = (color) => `display:inline-block;background:${color}22;color:${color};padding:4px 12px;border-radius:20px;font-size:12px;font-weight:700;`;
const btnStyle    = `display:inline-block;background:#3b82f6;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:16px;`;

// ── Nouveau prospect ────────────────────────────────────────────────
async function notifyNewProspect(prospect, createdByName, recipients) {
  const statusColors = { 'Prospection':'#60a5fa','Premier contact':'#a78bfa','Qualification':'#fbbf24','Proposition':'#fb923c','Négociation':'#22d3ee','Closing':'#34d399','Perdu':'#f87171','Stand-by':'#94a3b8' };
  const color = statusColors[prospect.status] || '#60a5fa';

  const html = `<div style="${baseStyle}">
    <div style="${headerStyle}">
      <h1 style="margin:0;font-size:22px;font-weight:800;color:#e2e8f0">Pro<span style="color:#3b82f6">Spect</span> CRM</h1>
      <p style="margin:6px 0 0;color:#94a3b8;font-size:13px">Nouveau prospect ajouté</p>
    </div>
    <div style="${bodyStyle}">
      <p style="color:#94a3b8;font-size:13px;margin-bottom:20px">
        <strong style="color:#e2e8f0">${createdByName}</strong> vient d'ajouter un nouveau prospect au portefeuille.
      </p>
      <div style="background:#161c2e;border-radius:10px;padding:20px;border:1px solid #1e2740;margin-bottom:20px">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
          <div>
            <div style="font-size:20px;font-weight:800;color:#e2e8f0">${prospect.company}</div>
            <div style="font-size:13px;color:#94a3b8">${prospect.sector}</div>
          </div>
          <span style="${badgeStyle(color)}">${prospect.status}</span>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <tr><td style="padding:6px 0;color:#94a3b8;width:40%">N° Suivi</td><td style="color:#60a5fa;font-weight:700">${prospect.track_id}</td></tr>
          <tr><td style="padding:6px 0;color:#94a3b8">Key Person</td><td style="color:#e2e8f0">${prospect.keyperson}${prospect.poste ? ' — '+prospect.poste : ''}</td></tr>
          <tr><td style="padding:6px 0;color:#94a3b8">Localisation</td><td style="color:#e2e8f0">${prospect.location}</td></tr>
          <tr><td style="padding:6px 0;color:#94a3b8">Source</td><td style="color:#e2e8f0">${prospect.source || '—'}</td></tr>
          <tr><td style="padding:6px 0;color:#94a3b8">CA Potentiel</td><td style="color:#34d399;font-weight:700">${prospect.ca_potentiel ? Number(prospect.ca_potentiel).toLocaleString('fr-FR') + ' XOF' : '—'}</td></tr>
          <tr><td style="padding:6px 0;color:#94a3b8">Prochaine action</td><td style="color:#e2e8f0">${prospect.next_action || '—'}</td></tr>
        </table>
        ${prospect.comment ? `<div style="margin-top:14px;padding:12px;background:#0a0d14;border-radius:8px;font-size:13px;color:#94a3b8;border-left:3px solid #3b82f6">${prospect.comment}</div>` : ''}
      </div>
    </div>
    <div style="${footerStyle}">ProSpect CRM — Notification automatique · Ne pas répondre à cet email</div>
  </div>`;

  return transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to:   recipients.join(','),
    subject: `[ProSpect] Nouveau prospect : ${prospect.company} (${prospect.track_id})`,
    html,
  });
}

// ── Changement de statut ────────────────────────────────────────────
async function notifyStatusChange(prospect, oldStatus, newStatus, changedByName, comment, recipients) {
  const statusColors = { 'Prospection':'#60a5fa','Premier contact':'#a78bfa','Qualification':'#fbbf24','Proposition':'#fb923c','Négociation':'#22d3ee','Closing':'#34d399','Perdu':'#f87171','Stand-by':'#94a3b8' };
  const colorNew = statusColors[newStatus] || '#60a5fa';
  const colorOld = statusColors[oldStatus] || '#94a3b8';
  const isClosing = newStatus === 'Closing';

  const html = `<div style="${baseStyle}">
    <div style="${headerStyle}">
      <h1 style="margin:0;font-size:22px;font-weight:800;color:#e2e8f0">Pro<span style="color:#3b82f6">Spect</span> CRM</h1>
      <p style="margin:6px 0 0;color:#94a3b8;font-size:13px">${isClosing ? '🏆 CLOSING RÉALISÉ !' : 'Mise à jour statut prospect'}</p>
    </div>
    <div style="${bodyStyle}">
      ${isClosing ? `<div style="background:#10b98122;border:1px solid #10b981;border-radius:10px;padding:16px;text-align:center;margin-bottom:20px"><p style="font-size:18px;font-weight:800;color:#34d399;margin:0">🎉 Félicitations ! ${prospect.company} est maintenant client !</p></div>` : ''}
      <p style="color:#94a3b8;font-size:13px;margin-bottom:20px">
        <strong style="color:#e2e8f0">${changedByName}</strong> a mis à jour le statut de <strong style="color:#e2e8f0">${prospect.company}</strong> (${prospect.track_id}).
      </p>
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:20px;padding:16px;background:#161c2e;border-radius:10px">
        <span style="${badgeStyle(colorOld)}">${oldStatus}</span>
        <span style="color:#475569;font-size:20px">→</span>
        <span style="${badgeStyle(colorNew)}">${newStatus}</span>
      </div>
      ${comment ? `<div style="padding:14px;background:#0a0d14;border-radius:8px;font-size:13px;color:#94a3b8;border-left:3px solid ${colorNew};margin-bottom:16px"><strong style="color:#e2e8f0">Commentaire :</strong><br>${comment}</div>` : ''}
    </div>
    <div style="${footerStyle}">ProSpect CRM — Notification automatique · Ne pas répondre à cet email</div>
  </div>`;

  return transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to:   recipients.join(','),
    subject: `[ProSpect] ${isClosing ? '🏆 CLOSING' : 'Statut mis à jour'} : ${prospect.company} → ${newStatus}`,
    html,
  });
}

// ── Rappel prochaine action ─────────────────────────────────────────
async function notifyActionReminder(prospect, recipient) {
  const html = `<div style="${baseStyle}">
    <div style="${headerStyle}">
      <h1 style="margin:0;font-size:22px;font-weight:800;color:#e2e8f0">Pro<span style="color:#3b82f6">Spect</span> CRM</h1>
      <p style="margin:6px 0 0;color:#f59e0b;font-size:13px">⏰ Rappel — Action requise aujourd'hui</p>
    </div>
    <div style="${bodyStyle}">
      <div style="background:#161c2e;border-radius:10px;padding:20px;border:1px solid #1e2740">
        <div style="font-size:18px;font-weight:800;color:#e2e8f0;margin-bottom:4px">${prospect.company}</div>
        <div style="font-size:13px;color:#94a3b8;margin-bottom:16px">${prospect.track_id} · ${prospect.sector}</div>
        <div style="background:#f59e0b22;border:1px solid #f59e0b;border-radius:8px;padding:12px;font-size:14px;color:#fbbf24;font-weight:600">
          📌 ${prospect.next_action}
        </div>
        ${prospect.expected ? `<div style="margin-top:12px;font-size:13px;color:#94a3b8"><strong style="color:#e2e8f0">Résultat attendu :</strong> ${prospect.expected}</div>` : ''}
      </div>
    </div>
    <div style="${footerStyle}">ProSpect CRM — Rappel automatique quotidien</div>
  </div>`;

  return transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to:   recipient,
    subject: `[ProSpect] ⏰ Action requise : ${prospect.company} — ${prospect.next_action}`,
    html,
  });
}

module.exports = { notifyNewProspect, notifyStatusChange, notifyActionReminder };
