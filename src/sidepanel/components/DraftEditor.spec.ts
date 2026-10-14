import { describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import type { Draft } from '@lib/types';
import DraftEditor from './DraftEditor.vue';

const draft: Draft = {
  id: 'd1',
  ideaTopic: 'Topic',
  ideaAngle: 'Angle',
  text: 'Hello',
  createdAt: '2026-10-08T00:00:00.000Z',
};

describe('DraftEditor', () => {
  it('keeps the editor and the text when saving fails', async () => {
    const updateText = vi.fn(async () => Promise.reject(new Error('disk')));
    const wrapper = mount(DraftEditor, { props: editorProps(updateText) });
    await wrapper.get('[data-testid="draft-text"]').setValue('Hello there');
    await wrapper.get('[data-testid="save-draft"]').trigger('click');
    await flushPromises();
    expect(wrapper.get('[data-testid="editor-error"]').text()).toBe(
      'Не удалось сохранить текст. Попробуйте ещё раз.',
    );
    expect(wrapper.get('[data-testid="draft-text"]').element).toHaveProperty(
      'value',
      'Hello there',
    );
    await wrapper.get('[data-testid="close-editor"]').trigger('click');
    await flushPromises();
    expect(wrapper.emitted('close')).toBeUndefined();
  });

  it('confirms a successful save', async () => {
    const updateText = vi.fn(async () => {});
    const wrapper = mount(DraftEditor, { props: editorProps(updateText) });
    await wrapper.get('[data-testid="draft-text"]').setValue('Saved text');
    await wrapper.get('[data-testid="save-draft"]').trigger('click');
    await flushPromises();
    expect(updateText).toHaveBeenCalledWith('d1', 'Saved text');
    expect(wrapper.get('[data-testid="draft-saved-d1"]').text()).toBe('Сохранено');
    expect(wrapper.find('[data-testid="editor-error"]').exists()).toBe(false);
  });
});

function editorProps(updateText: (id: string, text: string) => Promise<void>) {
  return {
    draft,
    postsLeft: 2,
    updateText,
    approve: vi.fn(async () => {}),
    setMedia: vi.fn(async () => {}),
    setKind: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    regenerate: vi.fn(async () => {}),
  };
}
