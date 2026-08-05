const fs = require('fs')
const path = require('path')

const RENDERS_DIR = path.join(__dirname, 'renders')

// ── Manual cleanup: node cleanup.js ──────────────────────
// Deletes ALL photos in the renders folder
// Use this if you want to wipe everything manually

function cleanupAll() {
	if (!fs.existsSync(RENDERS_DIR)) {
		console.log('[CLEANUP] renders/ folder does not exist, nothing to clean')
		return
	}

	const files = fs.readdirSync(RENDERS_DIR)

	if (files.length === 0) {
		console.log('[CLEANUP] renders/ folder is already empty')
		return
	}

	let deleted = 0
	let failed = 0

	files.forEach(file => {
		try {
			fs.unlinkSync(path.join(RENDERS_DIR, file))
			deleted++
		} catch (err) {
			console.error(`[CLEANUP] Failed to delete ${file}:`, err.message)
			failed++
		}
	})

	console.log(`[CLEANUP] Done — deleted ${deleted} files, ${failed} failed`)
}

// ── Age-based cleanup ─────────────────────────────────────
// Deletes photos older than X hours
// Usage: node cleanup.js --hours=2

function cleanupOlderThan(hours) {
	if (!fs.existsSync(RENDERS_DIR)) {
		console.log('[CLEANUP] renders/ folder does not exist')
		return
	}

	const files = fs.readdirSync(RENDERS_DIR)
	const now = Date.now()
	const maxAge = hours * 60 * 60 * 1000
	let deleted = 0

	files.forEach(file => {
		const filePath = path.join(RENDERS_DIR, file)
		const age = now - fs.statSync(filePath).mtimeMs

		if (age > maxAge) {
			try {
				fs.unlinkSync(filePath)
				deleted++
			} catch (err) {
				console.error(`[CLEANUP] Failed to delete ${file}:`, err.message)
			}
		}
	})

	console.log(`[CLEANUP] Deleted ${deleted} photos older than ${hours} hour(s)`)
}

// ── Stats ─────────────────────────────────────────────────

function printStats() {
	if (!fs.existsSync(RENDERS_DIR)) {
		console.log('[STATS] renders/ folder does not exist')
		return
	}

	const files = fs.readdirSync(RENDERS_DIR)
	let totalBytes = 0

	files.forEach(file => {
		const filePath = path.join(RENDERS_DIR, file)
		totalBytes += fs.statSync(filePath).size
	})

	const totalMB = (totalBytes / 1024 / 1024).toFixed(2)
	console.log(`[STATS] ${files.length} photos | ${totalMB} MB used`)
}

// ── Run ───────────────────────────────────────────────────

const args = process.argv.slice(2)

if (args.includes('--stats')) {
	printStats()
} else if (args.some(a => a.startsWith('--hours='))) {
	const hoursArg = args.find(a => a.startsWith('--hours='))
	const hours = parseFloat(hoursArg.split('=')[1])
	if (isNaN(hours) || hours <= 0) {
		console.error('[CLEANUP] Invalid hours value')
		process.exit(1)
	}
	cleanupOlderThan(hours)
} else {
	cleanupAll()
}
