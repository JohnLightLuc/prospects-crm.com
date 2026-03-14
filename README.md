# ProSpect CRM — Guide d'installation complet

## Architecture

```
Client (navigateur)  ←──HTTP/WebSocket──→  Serveur Node.js  ←──→  PostgreSQL
     crm-b2b.html                            src/server.js          Base de données
```

---

## Prérequis

| Outil | Version minimale |
|-------|-----------------|
| Node.js | 18+ |
| PostgreSQL | 14+ |
| npm | 9+ |

---

## 1. Cloner et installer

```bash
# Copier le dossier crm-backend sur le serveur
cd crm-backend
npm install
```

---

## 2. Configurer l'environnement

```bash
cp .env.example .env
nano .env   # ou vim .env
```

Remplissez **chaque variable** dans `.env` :

```env
PORT=3000
DB_HOST=localhost
DB_PORT=5432
DB_NAME=prospect_crm
DB_USER=postgres
DB_PASSWORD=VOTRE_MOT_DE_PASSE
JWT_SECRET=GENEREZ_UNE_CLE_AVEC: openssl rand -base64 64
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=votre@gmail.com
SMTP_PASS=MOT_DE_PASSE_APP_GMAIL   # pas votre mdp Gmail habituel
EMAIL_FROM=ProSpect CRM <votre@gmail.com>
FRONTEND_URL=https://votre-domaine.com
```

> **Gmail — mot de passe app** : Compte Google → Sécurité → Validation en 2 étapes → Mots de passe des applications

---

## 3. Créer la base de données PostgreSQL

```bash
# Connexion à PostgreSQL
psql -U postgres

# Dans psql :
CREATE DATABASE prospect_crm;
\q

# Lancer la migration (crée toutes les tables)
npm run migrate
```

Résultat attendu :
```
✅ Tables créées avec succès.
👤 Compte admin créé : admin@prospect-crm.com / Admin@2025
   ⚠️  Changez le mot de passe après la première connexion !
```

---

## 4. Déployer le frontend

```bash
# Créer le dossier public (servi automatiquement par Express)
mkdir -p public
cp crm-b2b.html public/index.html
```

---

## 5. Démarrer le serveur

```bash
# Développement (redémarre automatiquement)
npm run dev

# Production
npm start
```

Accès : **http://localhost:3000**

---

## 6. Production avec PM2 (recommandé)

```bash
npm install -g pm2

# Démarrer
pm2 start src/server.js --name "prospect-crm"

# Démarrage automatique au reboot
pm2 startup
pm2 save

# Logs en temps réel
pm2 logs prospect-crm
```

---

## 7. Nginx (reverse proxy HTTPS)

```nginx
server {
    listen 80;
    server_name votre-domaine.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name votre-domaine.com;

    ssl_certificate     /etc/letsencrypt/live/votre-domaine.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/votre-domaine.com/privkey.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;

        # IMPORTANT pour Socket.io
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
# Certificat SSL gratuit avec Let's Encrypt
certbot --nginx -d votre-domaine.com
```

---

## API REST — Référence

### Authentification
| Méthode | Route | Description |
|---------|-------|-------------|
| POST | `/api/auth/login` | Connexion → retourne JWT |
| GET | `/api/auth/me` | Profil utilisateur connecté |
| GET | `/api/auth/users` | Liste utilisateurs (admin) |
| POST | `/api/auth/users` | Créer utilisateur (admin) |
| PUT | `/api/auth/password` | Changer mot de passe |

### Prospects
| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/prospects` | Liste + filtres (status, sector, q...) |
| POST | `/api/prospects` | Créer prospect + notif email |
| PUT | `/api/prospects/:id` | Modifier + historique si statut change |
| DELETE | `/api/prospects/:id` | Supprimer |
| GET | `/api/prospects/:id/history` | Historique des statuts |

### Rapports & Objectifs
| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/kpis` | KPIs globaux |
| GET | `/api/hebdo` | Rapport 7 derniers jours |
| GET | `/api/mensuel?mois=3&annee=2026` | Rapport mensuel |
| GET | `/api/objectifs` | Objectifs du mois courant |
| PUT | `/api/objectifs` | Sauvegarder objectifs |

---

## Événements Socket.io (temps réel)

| Événement | Direction | Données |
|-----------|-----------|---------|
| `prospect:created` | Serveur → Clients | Objet prospect complet |
| `prospect:updated` | Serveur → Clients | Objet prospect mis à jour |
| `prospect:deleted` | Serveur → Clients | `{ id }` |
| `user:connected` | Serveur → Clients | `{ nom, email }` |
| `user:disconnected` | Serveur → Clients | `{ nom }` |
| `objectifs:updated` | Serveur → Clients | Objet objectifs |

---

## Gestion des utilisateurs

L'admin peut créer des comptes via l'API ou directement en base :

```bash
# Via API (POST /api/auth/users avec token admin)
curl -X POST http://localhost:3000/api/auth/users \
  -H "Authorization: Bearer TOKEN_ADMIN" \
  -H "Content-Type: application/json" \
  -d '{"nom":"Marie Dupont","email":"marie@societe.com","password":"MonMotDePasse1!","role":"commercial"}'
```

Rôles disponibles : `admin`, `manager`, `commercial`

---

## Emails automatiques

3 types de notifications sont envoyées automatiquement :

1. **Nouveau prospect** → tous les utilisateurs actifs
2. **Changement de statut** → tous les utilisateurs actifs (avec mise en avant si Closing 🏆)
3. **Rappels quotidiens** → chaque matin à 8h, rappel des actions planifiées ce jour

---

## Dépannage

**Erreur connexion DB** : Vérifiez `DB_PASSWORD` dans `.env` et que PostgreSQL tourne (`pg_lscluster`)

**Socket.io ne se connecte pas** : Vérifiez que Nginx a bien les headers `Upgrade` et `Connection`

**Emails non reçus** : Vérifiez que vous utilisez un "mot de passe d'application" Gmail et non votre mot de passe principal

**Token expiré** : Normal après `JWT_EXPIRES_IN` (7 jours par défaut) — se reconnectez

---

## Structure des fichiers

```
crm-backend/
├── src/
│   ├── server.js              ← Point d'entrée
│   ├── routes/
│   │   ├── auth.js            ← Login, users
│   │   ├── prospects.js       ← CRUD prospects
│   │   └── reports.js         ← KPIs, rapports, objectifs
│   ├── middleware/
│   │   └── auth.js            ← Vérification JWT
│   ├── services/
│   │   ├── emailService.js    ← Modèles d'emails HTML
│   │   └── reminderService.js ← Rappels quotidiens
│   ├── socket/
│   │   └── socketHandler.js   ← Événements temps réel
│   └── migrations/
│       └── init.js            ← Création des tables SQL
├── config/
│   └── database.js            ← Pool PostgreSQL
├── public/
│   └── index.html             ← Frontend CRM (à copier ici)
├── .env.example
└── package.json
```
