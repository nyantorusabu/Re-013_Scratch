(async () => {
	const SRC = 'https://nyantorusabu.github.io/Re-013_Scratch';
	async function LoadAssets() {
		if (!window.NDT) {
			console.log('🛠️ NDTを読み込み中...');
			await new Promise((resolve, reject) => {
				const script = document.createElement('script');
				script.src = `https://nyantorusabu.github.io/NDT/NekoDevTools.js`;
				script.onload = resolve;
				script.onerror = () =>
					reject(new Error('Loaderの読み込みに失敗しました'));
				document.body.appendChild(script);
			});
		}
		if (!window.Scratch) {
			console.log('🛠️ Loaderを読み込み中...');
			await new Promise((resolve, reject) => {
				const script = document.createElement('script');
				script.src = `${SRC}/Loader.js`;
				script.onload = resolve;
				script.onerror = () =>
					reject(new Error('Loaderの読み込みに失敗しました'));
				document.body.appendChild(script);
			});
		}
	}

	await LoadAssets();

	await NDT.Spr.Add(`${SRC}/NYADDON.sprite3`);
})();
