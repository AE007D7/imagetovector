document.querySelectorAll('.example-slider').forEach(slider => {
  const update = () => {
    slider.closest('.example-compare').style.setProperty('--split', slider.value + '%');
    slider.setAttribute('aria-valuetext', slider.value + ' percent left image');
  };
  slider.addEventListener('input', update);
  update();
});
