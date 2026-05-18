import readline from "readline"

export const screen_clear = () => {
  console.clear();
}
export const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
})


export const main_menu_display = () => {
  console.log('\t[0] - Manual Sell 100%');
  console.log('\t[1] - Manual Sell 50%');
  console.log('\t[2] - Exit');
}