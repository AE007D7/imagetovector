document.querySelectorAll('.example-slider').forEach(slider => {
  const comparison = slider.closest('.example-compare');
  let activePointer = null;
  const update = () => {
    comparison.style.setProperty('--split', slider.value + '%');
    slider.setAttribute('aria-valuetext', slider.value + ' percent left image');
  };
  const move = event => {
    const bounds = comparison.getBoundingClientRect();
    if (!bounds.width) return;
    slider.value = Math.round(Math.max(0, Math.min(100, (event.clientX - bounds.left) / bounds.width * 100)));
    update();
  };
  slider.addEventListener('pointerdown', event => {
    if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault();
    activePointer = event.pointerId;
    slider.focus({ preventScroll: true });
    slider.setPointerCapture(event.pointerId);
    comparison.classList.add('is-dragging');
    move(event);
  });
  slider.addEventListener('pointermove', event => {
    if (event.pointerId === activePointer) move(event);
  });
  const stop = event => {
    if (event.pointerId !== activePointer) return;
    activePointer = null;
    comparison.classList.remove('is-dragging');
    if (slider.hasPointerCapture(event.pointerId)) slider.releasePointerCapture(event.pointerId);
  };
  slider.addEventListener('pointerup', stop);
  slider.addEventListener('pointercancel', stop);
  slider.addEventListener('lostpointercapture', stop);
  slider.addEventListener('input', update);
  update();
});
