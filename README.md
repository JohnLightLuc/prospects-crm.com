# ProSpect CRM B2B — Guide de démarrage rapide

## Contenu du package

```
prospect-crm/
├── src/
│   ├── server.js                  ← Point d'entrée principal
│   ├── routes/
│   │   ├── auth.js                ← Login, gestion utilisateurs
│   │   ├── prospects.js           ← CRUD prospects
│   │   └── reports.js             ← KPIs, rapports, objectifs
│   ├── middleware/
│   │   └── auth.js                ← Vérification JWT
│   ├── services/
│   │   ├── emailService.js        ← Emails automatiques HTML
│   │   └── reminderService.js     ← Rappels quotidiens à 8h
│   ├── socket/
│   │   └── socketHandler.js       ← Temps réel Socket.io
│   └── migrations/
│       └── init.js                ← Création des tables SQL
├── config/
│   └── database.js                ← Pool PostgreSQL
├── public/
│   └── index.html                 ← Frontend CRM complet
├── docs/
│   ├── Guide_Installation_Dev.docx ← 7 étapes illustrées
│   └── API_Documentation.docx     ← Documentation API complète
├── package.json
└── .env.example                   ← Template de configuration
```

## Installation en 5 commandes

```bash
npm install
cp .env.example .env
# Éditer .env avec vos paramètres
npm run migrate
pm2 start src/server.js --name "prospect-crm"
```

## Première connexion

URL     : https://votre-domaine.com
Email   : admin@prospect-crm.com
Mot de passe : Admin@2025

⚠️  Changer ce mot de passe immédiatement après la première connexion.

## Documentation complète

Consulter le dossier docs/ pour :
- Guide_Installation_Dev.docx : installation pas à pas (Nginx, SSL, PM2)
- API_Documentation.docx : tous les endpoints REST + WebSocket + schéma DB
