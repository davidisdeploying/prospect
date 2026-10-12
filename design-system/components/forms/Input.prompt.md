**Input** — labeled text field in a sunken well with a gold focus ring; mono uppercase label.

```jsx
<Input label="Role" placeholder="Senior Backend Engineer" />
<Input label="Comp" mono placeholder="$185–215k" />
<Input label="URL" invalid hint="Enter a valid listing URL" />
```

Pass `mono` for codes/comp/dates, `invalid` + `hint` for errors. Spreads native input props.
