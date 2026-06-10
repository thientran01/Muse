import styled from 'styled-components'

// The styled-components demo: the values live in these tagged-template bodies.
// Select an element in this card and scrub; the engine resolves the component's
// same-file styled definition and edits the declaration inside the template (the
// styled path) — the nested &:hover stays untouched (top-level-only editing).
const Shell = styled.div`
  padding: 24px;
  border-radius: 16px;
  background-color: #3f6f5f;
  color: #f2f7f4;
`

const Title = styled.h3`
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.01em;
`

const Blurb = styled.p`
  margin-top: 8px;
  font-size: 14px;
  line-height: 1.6;
  color: #d8e8e0;
`

const Action = styled.button`
  margin-top: 16px;
  padding: 8px;
  border-radius: 10px;
  background-color: #f2f7f4;
  color: #3f6f5f;
  font-size: 13px;
  font-weight: 600;
  &:hover {
    opacity: 0.9;
  }
`

export function StyledCard() {
  return (
    <Shell>
      <Title>Styled by styled-components</Title>
      <Blurb>
        This card's values live in tagged-template literals. Scrub anything here and Muse rewrites the
        declaration inside the template body — the generated class hash never appears in your diff.
      </Blurb>
      <Action type="button">writes to the template</Action>
    </Shell>
  )
}
