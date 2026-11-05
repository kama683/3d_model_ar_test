import { CanvasTexture, LinearFilter, Sprite, SpriteMaterial, SRGBColorSpace } from 'three';

/** Текстовая подпись в 3D: спрайт с канвас-текстурой, всегда повёрнут к камере. */
export class Label {
  readonly sprite: Sprite;
  private readonly canvas = document.createElement('canvas');
  private readonly texture: CanvasTexture;
  private text = '';

  constructor(
    text: string,
    private readonly color: string,
    /** Высота подписи в метрах. */
    height = 0.12,
  ) {
    this.canvas.width = 512;
    this.canvas.height = 128;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.minFilter = LinearFilter;
    const material = new SpriteMaterial({ map: this.texture, transparent: true, depthWrite: false });
    this.sprite = new Sprite(material);
    this.sprite.scale.set(height * 4, height, 1);
    this.sprite.renderOrder = 10;
    this.setText(text);
  }

  setText(text: string): void {
    if (text === this.text) return;
    this.text = text;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const { width, height } = this.canvas;
    ctx.clearRect(0, 0, width, height);
    ctx.font = '600 56px -apple-system, "Segoe UI", Roboto, sans-serif';
    const textWidth = Math.min(width - 20, ctx.measureText(text).width + 56);
    const x = (width - textWidth) / 2;
    ctx.fillStyle = 'rgba(12, 12, 16, 0.72)';
    ctx.beginPath();
    ctx.roundRect(x, 14, textWidth, height - 28, 40);
    ctx.fill();
    ctx.fillStyle = this.color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, width / 2, height / 2 + 2, width - 60);
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
    this.sprite.material.dispose();
  }
}
