/*
 * https://github.com/morethanwords/tweb
 * Copyright (C) 2019-2021 Eduard Kuzmenko
 * https://github.com/morethanwords/tweb/blob/master/LICENSE
 */

import rootScope from '@lib/rootScope';
import wrapSticker from '@components/wrappers/sticker'
import {Modify} from '@types';
import {getFluentEmojiUrl} from '@lib/nostra/fluent-emoji';

export default async function wrapStickerEmoji(options: Modify<Parameters<typeof wrapSticker>[0], {
  div: HTMLElement,
  doc?: never,
  loop?: never
}>) {
  const {
    emoji,
    div,
    width,
    height,
    managers = rootScope.managers
  } = options;
  const doc = await managers.appStickersManager.getAnimatedEmojiSticker(emoji);
  if(!doc) {
    div.classList.add('media-sticker-wrapper');

    // Nostra-mode fallback: tweb has no sticker set, but Fluent Emoji
    // (MIT) ships a static-PNG bundle that covers common emoji used by
    // theme chips, big-emoji bubbles, etc. Render it as <img>.
    const fluentUrl = getFluentEmojiUrl(emoji);
    if(fluentUrl) {
      const img = document.createElement('img');
      img.src = fluentUrl;
      img.alt = emoji;
      img.decoding = 'async';
      img.loading = 'lazy';
      if(width) img.width = width;
      if(height) img.height = height;
      img.style.width = '100%';
      img.style.height = '100%';
      img.style.objectFit = 'contain';
      div.append(img);
      // Shape-compatible with wrapSticker's return so callers doing
      // `.then(({render}) => render).then((player) => …)` keep working.
      // There is no RLottiePlayer here — callers storing the player
      // should null-check (they already do for the error path).
      return {render: Promise.resolve(null), downloaded: true} as any;
    }

    throw new Error('no sticker');
  }

  return wrapSticker({
    doc,
    play: true,
    loop: false,
    ...options
  });
}
