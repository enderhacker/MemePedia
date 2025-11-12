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
app.use(express.json());

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

// --- Serve emails ---
const mailDBPath = path.resolve("./data/mailDatabase.json");
let mailDatabase = {};
if (fs.existsSync(mailDBPath)) {
	mailDatabase = JSON.parse(fs.readFileSync(mailDBPath, "utf-8"));
}
if (!mailDatabase || typeof mailDatabase !== "object") {
	console.error("❌ Invalid mail database format.");
	return;
}
app.post("/api/getEmails", (req, res) => {
	try {
		console.log("\n📩 Incoming /api/getEmails request");

		const { username, password } = req.body;
		console.log("➡️ Raw body:", req.body);

		// --- Basic structure validation ---
		if (typeof username !== "string" || typeof password !== "string") {
			console.warn("⚠️ Invalid body structure. Expected strings for username/password.");
			return res.status(200).json({ success: false, error: "Invalid body" });
		}

		// --- Decode Base64 safely ---
		let decodedUser, decodedPass;
		try {
			decodedUser = Buffer.from(username, "base64").toString("utf8").trim().toLowerCase();
			decodedPass = Buffer.from(password, "base64").toString("utf8").trim();
			console.log(`🧩 Decoded username: ${decodedUser}`);
			console.log(`🔑 Decoded password: ${decodedPass}`);
		} catch (e) {
			console.error("❌ Error decoding Base64:", e);
			return res.status(200).json({ success: false });
		}

		// --- Validation ---
		if (!decodedUser || !decodedPass || decodedUser.length < 1 || decodedPass.length < 1 || !/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(decodedUser)) {
			console.warn("⚠️ Validation failed for decoded credentials.");
			return res.status(200).json({ success: false });
		}

		// --- Read mail database ---
		const user = mailDatabase[decodedUser];
		console.log(user ? `📬 Found user in database: ${decodedUser}` : `❌ No user found for ${decodedUser}`);

		// --- Auth check ---
		if (!user || user.password !== decodedPass) {
			console.warn(`🚫 Authentication failed for ${decodedUser}`);
			return res.status(200).json({ success: false });
		}

		console.log(`✅ Authentication successful for ${decodedUser}`);
		console.log(`📨 Sending ${user.emails.length} emails.`);

		// --- Success ---
		res.status(200).json({ success: true, emails: user.emails });
	} catch (err) {
		console.error("💥 getEmails error:", err);
		res.status(400).json({ success: false });
	}
});

(async function registerFontRoutes() {
    try {
        const fontsDir = path.join(process.cwd(), 'fonts');
        const files = await fs.promises.readdir(fontsDir);

        files.forEach(file => {
            const ext = path.extname(file).toLowerCase();
            const name = path.basename(file, ext);

            if (['.ttf', '.otf', '.woff', '.woff2'].includes(ext)) {
                const filePath = path.join(fontsDir, file);

                // MIME type mapping
                const mimeType = {
                    '.ttf': 'font/ttf',
                    '.otf': 'font/otf',
                    '.woff': 'font/woff',
                    '.woff2': 'font/woff2'
                }[ext] || 'application/octet-stream';

                // Serve at /font
                app.get(`/${name}`, (req, res) => {
                    res.type(mimeType);
                    res.sendFile(filePath);
                });

                // Serve at /font.ext
                app.get(`/${name}${ext}`, (req, res) => {
                    res.type(mimeType);
                    res.sendFile(filePath);
                });

                console.log(`Registered font routes: /${name} and /${name}${ext} -> ${file}`);
            }
        });
    } catch (err) {
        console.error('Error reading fonts directory:', err);
    }
})();

// --- Publish Pages ---
publishFile("/bec5d5040b7df76f319de5e40a82ad1335d9ab3d23f4f6ff1ab6597c72819333", "./html/about.html");
publishFile("/61c1878564b8b4ad1e616452ef28ed927f6723d1d5ced2f39fd842a1839d7ea4", "./html/curvedmail.html");
publishFile("/c40fbc15b206edccd7b21b63c5379d9b049598fadd81544e26de27e501572da9", "./html/forum.html");
publishFile("/395b46de6c56b0518e08b07182c1ff4a340e0bb6ca7b315a8967a4d02b44b76d", "./html/gallery.html");
publishFile("/fc7aec81e8f347c64317ac296f5e723ddc8e65c5633084edc33f41d69e620e44", "./html/ITSNOTME.html");
publishFile("/a15c2ab34008389122288d06521382beb04dde0f0e7eae4f0e025e73838feecc", "./html/projectunveil.html");
publishFile("/4b3c126cf6c073a2d6f962afd5f072b52b1432119602644c43308ca79ff4e08e", "./html/unveil.html");
publishFile("/0a04702c2d3c4ce70f0b876f70ab37ce13108c79c756fcbbdda8e4e927207869", "./html/ENTER_THE_MIRROR.html");
publishFile("/157dd9d6f7d7fb22f4c950a8f6713276b53b92a00eb4f195f7400dfb958fcca6", "./html/newspaper.html");

publishFile("/e5f0df71d19f1cb40304a4524042f0feb4f1769fb967ce269922f8721bc3e917", "./data/eyeascii.json");

publishFile("/24d8fbbc0b0629acf787bb9ece916f209c6184526a6ec6fa628d9bc2840c7764", "./css/scrollbar.css");

publishFile("/e2d59fbab9a76cfd9b1d8a9b7db60ad2e4c77cf5d324b4e9b5a6a1a9cb5162c9", "./images/curvedmail.jpg");
publishFile("/72a44cb9a9bfa47f93e04f5a8d1a37961a2efb8bc44c18f4038d20b5e9b4cf10", "./images/DealWithIt.png");
publishFile("/0bce4769b4cbe2280f27e8e7699a13b7e3c43efc861ffb9ef3b6995bbcc23f5d", "./images/Doge.jpg");
publishFile("/6a5142ac9b9b985f27e861bbd4e33c6ad2d2af7e05a284e79b83e68266dcbfc7", "./images/EmojiLionKing.jpg");
publishFile("/f1a327eb1b8293f0df25acb6e4f12b3a986ef06c63a57f539a7a4f12f4517e2e", "./images/eye.png");
publishFile("/c34949df4e831b0d8a8eb4b8f7c6e3ed4cb0d1ce8126f8f22d9ac6a9e5139b26", "./images/face.png");
publishFile("/b92fcae4d2e6a43162a6e2b64b963e7126ef92c4c6b7c84508d3227f4cc6ed78", "./images/face2.png");
publishFile("/26a37df7c937e1ff047ae0c3b6dcb51ccf15e8b8da4d02d80e961f2a8260e23e", "./images/facemelted.png");
publishFile("/84f5ce8c30a621f6ef34a8a38b9a12c1c75c187d6f442b27a6edc6cc40413a9b", "./images/helloyesthisisdog.jpg");
publishFile("/79b81ff2a8cf7ebad4d95c1b7351f24a83e7a8d319da2f6e9a0b3af2bb12e597", "./images/HeManSings.jpg");
publishFile("/e03d9c1d3a47a9652d873b1e8d01b4cf5c28d173cba7e8b480a2196b4283d251", "./images/IHeardULiekMudkipz.jpg");
publishFile("/ac57241fc9a4a09696dff89272598c2594365686d25e84137d207fd4c49f6f2b", "./images/Komica.jpg");
publishFile("/9fd8a9b27cf86d9129f1edc6c2d47e25cb8f3cfe11984d1a67b946f00ee4b8c4", "./images/MemePediaArchive.jpg");
publishFile("/48a87d19adf0f0dcfbf41e41bcb2875b90a8b5f5b46c929e8d29b20368cd9618", "./images/PepeTheFrog.jpg");
publishFile("/fb2c487d2f19a7c3122f0f46a75ed6f9ab1b6f4cb1eb68cf27b2f91b62b9572a", "./images/SpeedyCat.jpg");
publishFile("/2a17b51cb39a0c6c67c0eec8a4c511c2cbe4159cb2b83c973b3d1aeb6a14586a", "./images/ThatFuckingCat.jpg");
publishFile("/e7421d2c7b4d2a8a4236c7b2c3f1a8b6d2c937e14efad237b0de5a6fa7a9d5cb", "./images/ThatsRacist.jpg");
publishFile("/a5f3b9b2c85a8c5baf95f7c83c6a429f2b9e7a3df7d12b8e4325bfb9b47ed820", "./images/UnderConstruction.png");
publishFile("/3e4a0bdf58f4a7a99f3c2b14cb987e6cdd46a3d8bf64b1b6b3a92a0dfb7814b6", "./images/UnveilLogoName.png");
publishFile("/9089f976186daa17b7e9bb4b3c0ddcaa1882c93bbde3013456043e505b624c67", "./images/Pr0yectUnv3ilLogo.png");

publishFile("/c3d794cff5e81c280aee4fd3f0968bf84164742833ad463b18e5144d1306bed5", "./images/about_original_DarrenHancock.jpeg");
publishFile("/9ba828a78ae3d0111e6ac0e3d1aa4e151b87312448cb58fa5af94072bfa97221", "./images/about_original_SamCarter.jpeg");
publishFile("/2d7b42abeaff03d4fae6f720d3dd4b82cd2ebacdb0d3aa7115e3f69140ed27ca", "./images/about_original_MariaIvanova.jpeg");
publishFile("/52670cb900db3145ba4d17b169b01466393921b0b41c24022ccd06dc153f2dab", "./images/about_original_EmilyRhodes.jpeg");
publishFile("/87dbeaeabef1ac5fabbc312e4f50a594e5f2bfdc3e3531b050e9319dd87e84dd", "./images/about_original_VictorLee.jpeg");
publishFile("/275eb533ada364dc9d91471375f9e2b4c0bf1654cec1fb447ae9fa6fd6139bfe", "./images/about_distorted_DarrenHancock.png");
publishFile("/59ca95861f6c8c46448bfa578a9a4950626ba265561035f47d800836bd2265fc", "./images/about_distorted_SamCarter.png");
publishFile("/c15283f4b728f88e85ab7bec3fe7057c810b8c00a8f0363e05f13081d82da18a", "./images/about_distorted_MariaIvanova.png");
publishFile("/14fab1d66d89658fd002348fb2934366c40465ebcf8ac4f686ed1ab0945ec491", "./images/about_distorted_EmilyRhodes.png");
publishFile("/8eb590f2bb544ba251569354919adcfe2b38dffc5b4a60662a10036e8be8fcc0", "./images/about_distorted_VictorLee.png");

publishFile("/e4fc780f974374a885e0246a100a3405285edf85e9e97e27583702fe0afff0df", "./sounds/Success.mp3");
publishFile("/ded2d40110abb9075e42bb31f69a6799bf25e515a8403549d4a8f0706877da9e", "./sounds/Blurred.mp3");

// 6da53329402540dee8230bdce3c339b2438767b6fcf3ec6f9df20ea996ce5ee7
// ad01dbe10a4e567094a3861103089fad02b2e9327051db89d748f320cb538e88
// e69ef03be5ba8d0ad520267dad768ee0c9e7ea90489e3f99abde2bba1a9adf11
// b4840da99696ec91badda36e0d399f4063ea1a5992e27e1df278aa3420627b78
// dbb21a75f47c1e246f9a1d048ef317f3b23a0886aac915ffa4fe9f4f228f686a
// 1246896f4c76bcc92b86cf9866cef6d7724448a511b6e5de225f8c77199cc2cf
// 6dba972e8d9e63ed9b48ec21539f388820cc56740c67deff44f80a93cd912143
// 9e63db98b1d098843c9ec445d31a429a181c94cf6e5369078438b15fa62ef9ae
// 1c0a9d9b9432efa048ee2a9afdfaab1f663a9bdbe3cfeb2723fcc432ae2ea66e
// f43510989d61ec5905c6896c1c535003879a1e942ff946a81cf5ba0fcf724410

app.use(function (req, res) {
	res.status(404).sendFile(path.join(__dirname, "html", "404.html"));
});

// --- App Listen ---
app.listen(PORT, () => {
	console.log(`💾 Server running at http://localhost:${PORT}`);
});
