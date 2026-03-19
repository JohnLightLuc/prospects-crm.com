// src/services/reminderService.js
// Envoie chaque matin les rappels pour les actions du jour
const pool = require('../../config/database');
const { notifyActionReminder } = require('./emailService');

async function sendDailyReminders() {
  try {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const { rows } = await pool.query(`
      SELECT p.*, u.email AS user_email, u.nom AS user_nom
      FROM prospects p
      LEFT JOIN users u ON p.created_by = u.id AND u.company_id = p.company_id
      WHERE p.next_date = $1
        AND p.status NOT IN ('Closing','Perdu')
        AND p.next_action IS NOT NULL
    `, [today]);

    console.log(`⏰ Rappels du jour : ${rows.length} action(s) planifiée(s)`);
    for (const prospect of rows) {
      if (prospect.user_email) {
        await notifyActionReminder(prospect, prospect.user_email);
        console.log(`  → Rappel envoyé à ${prospect.user_email} pour ${prospect.company}`);
      }
    }
  } catch (err) {
    console.error('Erreur rappels quotidiens :', err.message);
  }
}

function startReminderCron() {
  // Vérifier toutes les heures si on est à 8h du matin
  setInterval(async () => {
    const h = new Date().getHours();
    if (h === 8) await sendDailyReminders();
  }, 60 * 60 * 1000); // toutes les heures

  // Lancer immédiatement si heure de démarrage = 8h
  if (new Date().getHours() === 8) sendDailyReminders();

  console.log('⏰ Service de rappels quotidiens démarré (envoi à 8h)');
}

module.exports = { startReminderCron, sendDailyReminders };
