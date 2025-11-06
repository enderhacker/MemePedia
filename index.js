const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { Visits } = require("./database");

const app = express();
const PORT = process.env.PORT || 3000;

app.disable("x-powered-by");
app.use((req, res, next) => {
	res.removeHeader("X-Powered-By");
	res.removeHeader("ETag");
	res.removeHeader("Date");
	res.removeHeader("Connection");
	next();
});

function publishFile(urlPath, filePath) {
	const resolvedPath = path.resolve(filePath);
	if (!fs.existsSync(resolvedPath)) {
		console.error(`❌ File not found: ${resolvedPath}`);
		return;
	}

	app.get(urlPath, (req, res) => {
		res.sendFile(resolvedPath);
	});
	console.log(`📎 Published '${resolvedPath}' at '${urlPath}'`);
}

// --- Publish main HTML file ---
app.get("/", async (req, res) => {
	try {
		const visits = await Visits.findByPk(1);
		if (visits) {
			visits.count++;
			await visits.save();
		} else {
			await Visits.create({ id: 1, count: 1 });
		}

		res.sendFile(path.join(__dirname, "html", "index.html"));
	} catch (err) {
		console.error("Error updating visits:", err);
		res.status(500).send("Internal Server Error");
	}
});

// --- Publish all ads with hashed filenames ---
const adsDir = path.resolve("./ads");
let adsList = [];
if (fs.existsSync(adsDir)) {
	const adsJsonPath = path.join(adsDir, "ads.json");
	let adsMeta = [];
	if (fs.existsSync(adsJsonPath)) {
		try {
			adsMeta = JSON.parse(fs.readFileSync(adsJsonPath, "utf-8"));
		} catch (err) {
			console.error("❌ Error parsing ads.json:", err);
		}
	}
	fs.readdirSync(adsDir).forEach((file) => {
		const filePath = path.join(adsDir, file);
		if (fs.statSync(filePath).isFile() && file !== "ads.json") {
			const buffer = fs.readFileSync(filePath);
			const hash = crypto.createHash("sha256").update(buffer).digest("hex");
			const ext = path.extname(file);
			const urlPath = `/ads/${hash}${ext}`;

			publishFile(urlPath, filePath);

			const baseName = path.basename(file, ext);
			const meta = adsMeta.find((m) => m.file === file) || {};
			adsList.push({
				imageUrl: urlPath,
				title: meta.label || baseName,
				description: meta.description || "No description available.",
				redirectUrl: meta.redirectUrl || null,
			});
		}
	});
} else {
	console.warn("⚠️  'ads' directory not found, skipping ad publishing.");
}
app.get("/api/getAd", (req, res) => {
	const sample = (arr, n) => {
		const a = arr.slice();
		const m = Math.min(n, a.length);
		const out = [];
		for (let i = 0; i < m; i++) {
			const idx = crypto.randomInt(0, a.length);
			out.push(a.splice(idx, 1)[0]);
		}
		return out;
	};

	res.json(sample(adsList, 2));
});

// --- Publish images ---
function publishImages() {
	const imagesDir = path.resolve("./images");

	if (!fs.existsSync(imagesDir)) {
		console.warn("⚠️  'images' directory not found, skipping publishing.");
		return;
	}

	fs.readdirSync(imagesDir).forEach((file) => {
		const filePath = path.join(imagesDir, file);

		if (!fs.statSync(filePath).isFile()) return;

		const buffer = fs.readFileSync(filePath);
		const hash = crypto.createHash("sha256").update(buffer).digest("hex");
		const ext = path.extname(file);
		const urlPath = `/images/${hash}${ext}`;

		publishFile(urlPath, filePath);
	});
}
publishImages();

// --- Fetch visit count ---
app.get("/api/getVisits", async (req, res) => {
	try {
		const visits = await Visits.findByPk(1);
		res.json({ visits: visits ? visits.count : 0 });
	} catch (err) {
		console.error("Error reading visits:", err);
		res.status(500).json({ visits: 0 });
	}
});

// --- Publish Pages ---
publishFile("/bec5d5040b7df76f319de5e40a82ad1335d9ab3d23f4f6ff1ab6597c72819333", "./html/about.html");
publishFile("/61c1878564b8b4ad1e616452ef28ed927f6723d1d5ced2f39fd842a1839d7ea4", "./html/curvedmail.html");
publishFile("/c40fbc15b206edccd7b21b63c5379d9b049598fadd81544e26de27e501572da9", "./html/forum.html");
publishFile("/395b46de6c56b0518e08b07182c1ff4a340e0bb6ca7b315a8967a4d02b44b76d", "./html/gallery.html");
publishFile("/fc7aec81e8f347c64317ac296f5e723ddc8e65c5633084edc33f41d69e620e44", "./html/ITSNOTME.html");
publishFile("/a15c2ab34008389122288d06521382beb04dde0f0e7eae4f0e025e73838feecc", "./html/projectunveil.html");
publishFile("/4b3c126cf6c073a2d6f962afd5f072b52b1432119602644c43308ca79ff4e08e", "./html/unveil.html");
publishFile("/e5f0df71d19f1cb40304a4524042f0feb4f1769fb967ce269922f8721bc3e917", "./data/eyeascii.json");
publishFile("/0a04702c2d3c4ce70f0b876f70ab37ce13108c79c756fcbbdda8e4e927207869", "./html/ENTER_THE_MIRROR.html");
// publishFile("/ac57241fc9a4a09696dff89272598c2594365686d25e84137d207fd4c49f6f2b", "./html/index.html");

app.all("/{splat*}", (req, res) => {
	res.status(404).sendFile(path.join(__dirname, "html", "404.html"));
});

// --- App Listen ---
app.listen(PORT, () => {
	console.log(`💾 Server running at http://localhost:${PORT}`);
});