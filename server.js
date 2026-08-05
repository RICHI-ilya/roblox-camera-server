const express = require('express')
const cors = require('cors')
const { v4: uuidv4 } = require('uuid')
const fs = require('fs')
const path = require('path')
const { createCanvas } = require('canvas')
const THREE = require('three')

const app = express()
app.use(cors())
app.use(express.json({ limit: '20mb' }))

const RENDERS_DIR = path.join(__dirname, 'renders')
if (!fs.existsSync(RENDERS_DIR)) fs.mkdirSync(RENDERS_DIR)

const sessionPhotos = {}

// ── Render ────────────────────────────────────────────────

function renderScene(cameraData, parts, skyData, lightingData) {
	const WIDTH = 512
	const HEIGHT = 512

	const canvas = createCanvas(WIDTH, HEIGHT)
	const ctx = canvas.getContext('2d')

	// Sky background color
	const sky = skyData?.color || [0.53, 0.81, 0.92]
	ctx.fillStyle = `rgb(${Math.floor(sky[0] * 255)}, ${Math.floor(sky[1] * 255)}, ${Math.floor(sky[2] * 255)})`
	ctx.fillRect(0, 0, WIDTH, HEIGHT)

	// Simple ground
	ctx.fillStyle = '#7ec850'
	ctx.fillRect(0, HEIGHT * 0.6, WIDTH, HEIGHT * 0.4)

	// Sort parts by distance to camera (far first = painter's algorithm)
	const camPos = new THREE.Vector3(...cameraData.position)
	const camLook = new THREE.Vector3(...cameraData.lookvector)

	const sorted = [...parts].sort((a, b) => {
		const da = new THREE.Vector3(...a.position).distanceTo(camPos)
		const db = new THREE.Vector3(...b.position).distanceTo(camPos)
		return db - da
	})

	// Simple perspective projection
	const FOV = 70 * (Math.PI / 180)
	const HALF_W = WIDTH / 2
	const HALF_H = HEIGHT / 2

	const camMatrix = new THREE.Matrix4()
	const up = new THREE.Vector3(0, 1, 0)
	const target = camPos.clone().add(camLook)
	camMatrix.lookAt(camPos, target, up)
	camMatrix.invert()

	function projectPoint(worldX, worldY, worldZ) {
		const point = new THREE.Vector4(worldX, worldY, worldZ, 1)
		point.applyMatrix4(camMatrix)

		if (point.z >= 0) return null // behind camera

		const focalLen = HALF_H / Math.tan(FOV / 2)
		const sx = (point.x / -point.z) * focalLen + HALF_W
		const sy = (-point.y / -point.z) * focalLen + HALF_H
		const scale = focalLen / -point.z

		return { x: sx, y: sy, scale, depth: -point.z }
	}

	sorted.forEach(p => {
		const proj = projectPoint(...p.position)
		if (!proj) return

		const color = p.color || [0.8, 0.8, 0.8]
		const r = Math.floor(color[0] * 255)
		const g = Math.floor(color[1] * 255)
		const b = Math.floor(color[2] * 255)

		// Size on screen based on actual part size and distance
		const screenW = p.size[0] * proj.scale
		const screenH = p.size[1] * proj.scale

		const x = proj.x - screenW / 2
		const y = proj.y - screenH / 2

		// Simple shading — darken based on Y rotation
		const shade = 0.7 + Math.random() * 0.3
		const sr = Math.floor(r * shade)
		const sg = Math.floor(g * shade)
		const sb = Math.floor(b * shade)

		ctx.fillStyle = `rgba(${sr},${sg},${sb},${1 - (p.transparency || 0)})`
		ctx.fillRect(x, y, screenW, screenH)

		// Edge highlight
		ctx.strokeStyle = `rgba(${Math.min(sr + 30, 255)},${Math.min(sg + 30, 255)},${Math.min(sb + 30, 255)},0.4)`
		ctx.lineWidth = 1
		ctx.strokeRect(x, y, screenW, screenH)
	})

	return canvas.toBuffer('image/png')
}

// ── Routes ────────────────────────────────────────────────

app.get('/', (req, res) => {
	res.json({ status: 'ok', renders: fs.readdirSync(RENDERS_DIR).length })
})

app.post('/render', (req, res) => {
	const { sessionId, camera, parts, sky, lighting } = req.body

	if (!sessionId || !camera || !parts) {
		return res
			.status(400)
			.json({ error: 'Missing sessionId, camera, or parts' })
	}

	try {
		const photoId = uuidv4()
		const filePath = path.join(RENDERS_DIR, `${photoId}.png`)

		const pngBuffer = renderScene(camera, parts, sky, lighting)
		fs.writeFileSync(filePath, pngBuffer)

		if (!sessionPhotos[sessionId]) sessionPhotos[sessionId] = []
		sessionPhotos[sessionId].push(photoId)

		console.log(
			`[RENDER] Session ${sessionId.slice(0, 8)} → ${photoId.slice(0, 8)} (${parts.length} parts)`,
		)

		res.json({ success: true, photoId, url: `/photo/${photoId}` })
	} catch (err) {
		console.error('[RENDER ERROR]', err)
		res.status(500).json({ error: 'Render failed', detail: err.message })
	}
})

app.get('/photo/:photoId', (req, res) => {
	const filePath = path.join(RENDERS_DIR, `${req.params.photoId}.png`)
	if (!fs.existsSync(filePath)) {
		return res.status(404).json({ error: 'Photo not found' })
	}
	res.setHeader('Content-Type', 'image/png')
	res.sendFile(filePath)
})

app.post('/cleanup', (req, res) => {
	const { sessionId } = req.body
	if (!sessionId) return res.status(400).json({ error: 'Missing sessionId' })

	const photos = sessionPhotos[sessionId] || []
	let deleted = 0

	photos.forEach(photoId => {
		const filePath = path.join(RENDERS_DIR, `${photoId}.png`)
		if (fs.existsSync(filePath)) {
			fs.unlinkSync(filePath)
			deleted++
		}
	})

	delete sessionPhotos[sessionId]
	console.log(
		`[CLEANUP] Session ${sessionId.slice(0, 8)} → deleted ${deleted} photos`,
	)
	res.json({ success: true, deleted })
})

// Auto cleanup photos older than 2 hours
setInterval(
	() => {
		const files = fs.readdirSync(RENDERS_DIR)
		const now = Date.now()
		let cleaned = 0

		files.forEach(file => {
			const filePath = path.join(RENDERS_DIR, file)
			const age = now - fs.statSync(filePath).mtimeMs
			if (age > 2 * 60 * 60 * 1000) {
				fs.unlinkSync(filePath)
				cleaned++
			}
		})

		if (cleaned > 0) console.log(`[AUTO CLEANUP] Removed ${cleaned} old photos`)
	},
	30 * 60 * 1000,
)

// ── Start ─────────────────────────────────────────────────

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`Camera server running on port ${PORT}`))
