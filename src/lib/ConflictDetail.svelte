<script lang="ts">
  import { Tag } from 'carbon-components-svelte';
  import type { Activity } from './types';
  import type { ActivityConflict } from './course-merge';

  export let conflict: ActivityConflict;
  export let side: 'local' | 'incoming';

  const fieldRows: Array<{ label: string; render: (activity: Activity) => string }> = [
    { label: '类型', render: (a) => a.type },
    { label: '标题', render: (a) => a.title },
    { label: '内容', render: (a) => a.content || '—' },
    { label: '音素', render: (a) => a.phonemes.join('、') || '—' },
    { label: '依赖', render: (a) => a.dependencies.join('、') || '无' },
    { label: '难度', render: (a) => `${a.difficulty}/5` },
    { label: '时长', render: (a) => `${a.duration} 分钟` },
    { label: '教师提示', render: (a) => a.prompt || '—' },
    { label: '无障碍说明', render: (a) => a.accessibility || '—' },
    { label: '练习反馈', render: (a) => a.feedback || '—' }
  ];

  $: activity = side === 'local' ? conflict.local : conflict.incoming;
  $: other = side === 'local' ? conflict.incoming : conflict.local;
  $: divergentFields = new Set(conflict.fields);
</script>

{#if activity}
  <dl class="conflict-detail">
    {#each fieldRows as row}
      {@const value = row.render(activity)}
      {@const otherValue = other ? row.render(other) : '（该侧不存在）'}
      <div class:divergent={divergentFields.has(row.label)}>
        <dt>{row.label}{#if divergentFields.has(row.label)}<Tag type="magenta" style="margin-left:6px">两边不同</Tag>{/if}</dt>
        <dd>{value}</dd>
        <dd class="other-value">另一版：{otherValue}</dd>
      </div>
    {/each}
  </dl>
{/if}

<style>
  .conflict-detail {
    margin: 10px 0 0;
    display: grid;
    gap: 8px;
  }
  .conflict-detail > div {
    padding: 8px 10px;
    border: 1px solid #e0e0e0;
    background: #f4f4f4;
  }
  .conflict-detail > div.divergent {
    border-left: 3px solid #da1e28;
    background: #fff1f1;
  }
  dt {
    display: flex;
    align-items: center;
    margin-bottom: 4px;
    color: #6f6f6f;
    font-size: 10px;
    letter-spacing: .08em;
  }
  dd {
    margin: 0;
    font-size: 12px;
    line-height: 1.5;
    color: #161616;
    white-space: pre-wrap;
    word-break: break-word;
  }
  dd.other-value {
    margin-top: 3px;
    color: #8d8d8d;
    font-size: 10px;
  }
</style>
