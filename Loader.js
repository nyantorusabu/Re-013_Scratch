(async function initTurboWarpCompat() {
	console.log('🚀 TurboWarp互換環境の初期化を開始します...');

	// 1. NDT (NekoDevTools) の自動読み込みとVMの取得
	async function ensureNDT() {
		if (window.NDT && window.NDT.VM) return window.NDT;
		if (!window.NDT) {
			console.log('🛠️ NDTを読み込み中...');
			await new Promise((resolve, reject) => {
				const script = document.createElement('script');
				script.src =
					'https://nyantorusabu.github.io/NDT/NekoDevTools.js';
				script.onload = resolve;
				script.onerror = () =>
					reject(new Error('NDTの読み込みに失敗しました'));
				document.body.appendChild(script);
			});
		}

		// NDT読み込み後、VMがバインドされるのを待機
		let retries = 50;
		while (!window.NDT.VM && retries > 0) {
			await new Promise((r) => setTimeout(r, 100));
			retries--;
		}
		if (!window.NDT.VM) {
			throw new Error(
				'NDT.VM にアクセスできません。Scratchのプロジェクトエディタ（中を見る）上で実行してください。',
			);
		}
		return window.NDT;
	}

	try {
		const NDT = await ensureNDT();
		const vm = NDT.VM;

		// 2. Scratch API のモックアップ
		if (typeof window.Scratch === 'undefined') {
			window.Scratch = {};
			window.tsDatas = {};
			Scratch.translate = function (text) {
				return text;
			};
			Scratch.translate.setup = function () {};
		}

		// GUI側から ScratchBlocks を取得する関数（色反映用）
		function getScratchBlocksInfo() {
			const svgGroup = document.querySelector('.blocklySvg');
			if (!svgGroup) return null;
			const key = Object.keys(svgGroup).find(
				(k) =>
					k.startsWith('__reactFiber$') ||
					k.startsWith('__reactInternalInstance$'),
			);
			if (!key) return null;
			let fiber = svgGroup[key];
			let ScratchBlocks = null;
			while (fiber) {
				if (fiber.stateNode && fiber.stateNode.ScratchBlocks) {
					ScratchBlocks = fiber.stateNode.ScratchBlocks;
					break;
				}
				fiber = fiber.return;
			}
			if (!ScratchBlocks && window.ScratchBlocks)
				ScratchBlocks = window.ScratchBlocks;
			if (!ScratchBlocks && window.Blockly)
				ScratchBlocks = window.Blockly;
			return { ScratchBlocks };
		}

		Object.assign(window.Scratch, {
			vm: vm,
			runtime: vm.runtime,
			BlockType: {
				BOOLEAN: 'Boolean',
				BUTTON: 'button',
				COMMAND: 'command',
				CONDITIONAL: 'conditional',
				EVENT: 'event',
				HAT: 'hat',
				LOOP: 'loop',
				REPORTER: 'reporter',
				LABEL: 'label',
			},
			ArgumentType: {
				ANGLE: 'angle',
				BOOLEAN: 'Boolean',
				COLOR: 'color',
				IMAGE: 'image',
				MATRIX: 'matrix',
				NOTE: 'note',
				NUMBER: 'number',
				STRING: 'string',
				COSTUME: 'costume',
				SOUND: 'sound',
			},
			TargetType: { SPRITE: 'sprite', STAGE: 'stage' },
			Cast: {
				toNumber: (v) => Number(v) || 0,
				toString: (v) => String(v),
				toBoolean: (v) => {
					if (typeof v === 'boolean') return v;
					if (typeof v === 'string')
						return !(
							v === '' ||
							v === '0' ||
							v.toLowerCase() === 'false'
						);
					return !!v;
				},
			},
		});

		if (!window.Scratch.extensions) window.Scratch.extensions = {};

		// 拡張機能登録のフック
		window.Scratch.extensions.register = function (extensionObject) {
			if (!extensionObject.getInfo) return;

			const originalGetInfo =
				extensionObject.getInfo.bind(extensionObject);
			extensionObject.getInfo = function () {
				const info = originalGetInfo();

				// メニューの省略記法を変換
				if (info.menus) {
					for (const menuName in info.menus) {
						const menu = info.menus[menuName];
						if (Array.isArray(menu) || typeof menu === 'string') {
							info.menus[menuName] = { items: menu };
						}
					}
				}

				// バニラでエラーになるボタンやラベルのブロックを除外
				if (info.blocks && Array.isArray(info.blocks)) {
					info.blocks = info.blocks.filter((block) => {
						if (typeof block === 'string') return false;
						if (!block || typeof block !== 'object') return false;
						const type = block.blockType;
						if (
							type === 'button' ||
							type === 'label' ||
							type === window.Scratch.BlockType.BUTTON ||
							type === window.Scratch.BlockType.LABEL
						) {
							return false;
						}
						return true;
					});
				}
				return info;
			};

			const extensionInfo = extensionObject.getInfo();
			const extId = extensionInfo.id;

			if (vm.extensionManager._loadedExtensions.has(extId)) {
				console.warn(
					`拡張機能 "${extId}" はすでに読み込まれています。`,
				);
				return;
			}

			const serviceName =
				vm.extensionManager._registerInternalExtension(extensionObject);
			vm.extensionManager._loadedExtensions.set(extId, serviceName);

			// GUIに色を適用
			const sbInfo = getScratchBlocksInfo();
			if (sbInfo && sbInfo.ScratchBlocks) {
				const ScratchBlocks = sbInfo.ScratchBlocks;
				const color1 = extensionInfo.color1 || '#0FBD8C';
				const color2 = extensionInfo.color2 || color1;
				const color3 = extensionInfo.color3 || color1;

				ScratchBlocks.Extensions.register(
					`colours_${extId}`,
					function () {
						if (typeof this.setColourFromRawValues === 'function') {
							this.setColourFromRawValues(color1, color2, color3);
						} else if (typeof this.setColour === 'function') {
							this.setColour(color1);
						}
					},
				);
			}

			if (typeof vm.extensionManager.refreshBlocks === 'function') {
				vm.extensionManager.refreshBlocks();
			}
			vm.emit('workspaceUpdate');
			vm.emit('EXTENSION_ADDED', extensionInfo);

			console.log(
				`✅ 拡張機能 "${extensionInfo.name || extId}" を読み込みました。`,
			);
		};

		// 3. fflateの自動読み込みとスプライト（extensionURLs）パッチ
		async function ensureFflate() {
			if (window.fflate) return window.fflate;
			return new Promise((resolve, reject) => {
				const script = document.createElement('script');
				script.src = 'https://unpkg.com/fflate@0.8.2';
				script.onload = () => resolve(window.fflate);
				script.onerror = () =>
					reject(new Error('fflateの読み込みに失敗しました'));
				document.body.appendChild(script);
			});
		}

		async function loadExtensionURL(url) {
			return new Promise((resolve, reject) => {
				const script = document.createElement('script');
				script.src = url;
				script.async = true;
				script.onload = () => resolve();
				script.onerror = () =>
					reject(new Error(`拡張機能の読み込み失敗: ${url}`));
				document.body.appendChild(script);
			});
		}

		// vm.addSprite() を1度だけフックする
		if (!vm._addSpritePatchedByNDT) {
			const originalAddSprite = vm.addSprite.bind(vm);

			vm.addSprite = async function (input) {
				let dataToLoad = input;
				try {
					// ZIP形式の場合
					if (
						input instanceof ArrayBuffer ||
						input instanceof Uint8Array
					) {
						const fflate = await ensureFflate();
						const u8 =
							input instanceof ArrayBuffer
								? new Uint8Array(input)
								: input;
						const unzipped = fflate.unzipSync(u8);
						const jsonKey = Object.keys(unzipped).find((k) =>
							k.endsWith('sprite.json'),
						);

						if (jsonKey) {
							const jsonString = fflate.strFromU8(
								unzipped[jsonKey],
							);
							const parsed = JSON.parse(jsonString);

							if (
								parsed.extensionURLs &&
								typeof parsed.extensionURLs === 'object'
							) {
								console.log(
									'📦 スプライト内に extensionURLs を検出しました。',
								);
								const urls = Object.values(
									parsed.extensionURLs,
								);
								for (const url of urls) {
									try {
										console.log(
											`🔄 拡張機能を読み込み中: ${url}`,
										);
										await loadExtensionURL(url);
									} catch (e) {
										console.error(e);
									}
								}
								delete parsed.extensionURLs;
								unzipped[jsonKey] = fflate.strToU8(
									JSON.stringify(parsed),
								);
								dataToLoad = fflate.zipSync(unzipped, {
									level: 0,
								});
							}
						}
					}
					// JSON形式の場合
					else if (typeof input === 'string') {
						const parsed = JSON.parse(input);
						if (
							parsed.extensionURLs &&
							typeof parsed.extensionURLs === 'object'
						) {
							console.log(
								'📦 JSON内に extensionURLs を検出しました。',
							);
							const urls = Object.values(parsed.extensionURLs);
							for (const url of urls) {
								try {
									console.log(
										`🔄 拡張機能を読み込み中: ${url}`,
									);
									await loadExtensionURL(url);
								} catch (e) {
									console.error(e);
								}
							}
							delete parsed.extensionURLs;
							dataToLoad = JSON.stringify(parsed);
						}
					}
				} catch (e) {
					console.error(
						'⚠️ スプライト読み込み前パッチでエラー。元のデータで続行します:',
						e,
					);
				}
				// 改変したデータで本来の読み込み処理へ
				return originalAddSprite(dataToLoad);
			};
			vm._addSpritePatchedByNDT = true;
		}

		console.log('✨ すべての初期化が完了しました！');
	} catch (error) {
		console.error('❌ 初期化エラー:', error);
	}
})();
