// export class CreateVideoDto {
//   modelId!: number;
//   resolution!: string;

//   prompt!: string;
//   negativePrompt?: string;

//   duration?: string;
//   mode?: 'std' | 'pro' | '4k';
//   sound?: 'on' | 'off';
//   sceneNumber?: number;
//   cost?: number;
// }

// export class CreateMotionControlVideoDto {
//   modelId!: number;

//   prompt?: string;
//   negativePrompt?: string;

//   // 'image': khớp hướng theo ảnh nhân vật (max video ref 10s)
//   // 'video': khớp hướng theo video ref (max 30s)
//   characterOrientation!: 'image' | 'video';

//   keepOriginalSound?: 'yes' | 'no';

//   mode?: 'std' | 'pro';

//   sceneNumber?: number;
//   cost?: number;
// }
export class MultiPromptItem {
  index!: number;
  prompt!: string;
  duration!: string;
}

export class CreateVideoDto {
  modelId!: number;
  resolution!: string;

  prompt!: string;
  negativePrompt?: string;

  duration?: string;
  mode?: 'std' | 'pro' | '4k';
  sound?: 'on' | 'off';
  sceneNumber?: number;
  cost?: number;

  // ── Multi-Shot ──────────────────────────────────────────────────────────
  multiShot?: boolean;
  // 'customize': user cung cấp multi_prompt (CustomMode)
  // 'intelligence': Kling tự phân cảnh từ prompt (non-CustomMode)
  shotType?: 'customize' | 'intelligence';
  // Chỉ dùng khi shotType = 'customize' (1–6 items)
  multiPrompt?: MultiPromptItem[];
}

export class CreateMotionControlVideoDto {
  modelId!: number;

  prompt?: string;
  negativePrompt?: string;

  // 'image': khớp hướng theo ảnh nhân vật (max video ref 10s)
  // 'video': khớp hướng theo video ref (max 30s)
  characterOrientation!: 'image' | 'video';

  keepOriginalSound?: 'yes' | 'no';

  mode?: 'std' | 'pro';

  sceneNumber?: number;
  cost?: number;
}