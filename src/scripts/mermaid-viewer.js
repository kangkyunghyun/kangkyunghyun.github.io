const dialog = document.querySelector('.diagram-dialog');
const viewport = dialog?.querySelector('.diagram-viewport');
const output = dialog?.querySelector('output');
let active = null;
let scale = 1;

function setScale(value) {
	if (!active) return;
	scale = Math.max(0.1, Math.min(3, value));
	active.diagram.style.setProperty('--diagram-scale', String(scale));
	output.value = `${Math.round(scale * 100)}%`;
	dialog.querySelector('[data-diagram-action="out"]').disabled = scale <= 0.1;
	dialog.querySelector('[data-diagram-action="in"]').disabled = scale >= 3;
}

if (dialog && viewport) {
	for (const diagram of document.querySelectorAll('article pre.mermaid')) {
		const frame = document.createElement('div');
		frame.className = 'diagram-frame';
		const tools = document.createElement('div');
		tools.className = 'diagram-tools';
		const hint = document.createElement('span');
		hint.textContent = '넓은 그림은 가로로 스크롤할 수 있어요';
		const button = document.createElement('button');
		button.type = 'button';
		button.textContent = '크게 보기';
		button.disabled = true;
		diagram.before(frame);
		tools.append(hint, button);
		frame.append(tools, diagram);
		diagram.tabIndex = 0;
		diagram.setAttribute('role', 'region');
		diagram.setAttribute('aria-label', '흐름도, 가로 스크롤 가능');

		// Mermaid renders asynchronously and replaces the SVG on theme changes.
		const sizeDiagram = () => {
			const svg = diagram.querySelector('svg');
			if (!svg?.viewBox.baseVal.width) return;
			diagram.style.setProperty('--diagram-width', `${svg.viewBox.baseVal.width}px`);
			button.disabled = false;
		};
		new MutationObserver(sizeDiagram).observe(diagram, { childList: true, subtree: true });
		sizeDiagram();

		button.addEventListener('click', () => {
			active = { diagram, frame, button, scrollLeft: diagram.scrollLeft };
			frame.style.minHeight = `${frame.offsetHeight}px`;
			// Move the original SVG with its container to keep marker IDs unique.
			viewport.append(diagram);
			dialog.showModal();
			document.documentElement.classList.add('diagram-open');
			setScale(1);
			viewport.scrollTo(0, 0);
			dialog.querySelector('[data-diagram-action="close"]').focus();
		});
	}

	dialog.addEventListener('click', (event) => {
		if (event.target === dialog) dialog.close();
		const action = event.target.closest('[data-diagram-action]')?.dataset.diagramAction;
		if (!active || !action) return;
		if (action === 'close') dialog.close();
		else if (action === 'in') setScale(scale + 0.25);
		else if (action === 'out') setScale(scale - 0.25);
		else if (action === 'reset') setScale(1);
		else if (action === 'fit') {
			const box = active.diagram.querySelector('svg')?.viewBox.baseVal;
			if (box) setScale(Math.min((viewport.clientWidth - 32) / box.width, (viewport.clientHeight - 32) / box.height));
		}
	});
	dialog.addEventListener('close', () => {
		if (!active) return;
		active.diagram.style.removeProperty('--diagram-scale');
		active.frame.append(active.diagram);
		active.diagram.scrollLeft = active.scrollLeft;
		active.frame.style.removeProperty('min-height');
		document.documentElement.classList.remove('diagram-open');
		active.button.focus();
		active = null;
	});
}
