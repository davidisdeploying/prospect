**Dialog** — modal in a raised slate panel over a slate scrim; slab title, sans body, footer actions. Used for "Stake a claim" and confirmations.

```jsx
<Dialog open={open} title="Stake a claim" onClose={close}
  footer={<><Button variant="quiet" onClick={close}>Cancel</Button><Button variant="gold">Stake a claim</Button></>}>
  <Input label="Role" />
</Dialog>
```
