// Alternatif PM2 (jika tidak memakai systemd):
//   npm i -g pm2 && cd /srv/downshit/current && pm2 start deploy/pm2/ecosystem.config.cjs
//   pm2 save && pm2 startup     # jalankan perintah yang dicetak
module.exports = {
	apps: [
		{
			name: 'downshit',
			cwd: '/srv/downshit/current',
			script: 'build/index.js',
			node_args: '--env-file=/srv/downshit/shared/.env',
			instances: 1, // SQLite + satu proses: jangan cluster/instances > 1 (penulis tunggal)
			autorestart: true,
			max_restarts: 10,
			restart_delay: 3000,
			time: true
		}
	]
};
