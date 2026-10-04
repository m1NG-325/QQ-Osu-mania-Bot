import { parseCommand } from './bot.js';
import { queryLane, heavyLane, ResultCache, SenderQueue, queryBudget, timedWork, checkCancelled } from './runtime.js';

export class QueryService {
  constructor({ bot, bindings, history, cache=new ResultCache(), ordinary=queryLane, heavy=heavyLane, budget=queryBudget }) {
    Object.assign(this,{bot,bindings,history,cache,ordinary,heavy,budget});
    this.senders=new SenderQueue();
  }
  run(command,sender='local',context={}) {
    const parsed=parseCommand(command);
    return timedWork(signal => this.senders.run(sender,async()=>{
      checkCancelled(signal);
      const heavy=['p','m','a','v','recommend','tbp','随机','练习','群榜','对比'].includes(parsed?.action)
        || parsed?.action==='bp'&&parsed.index!=null || parsed?.count>16
        || parsed?.range&&parsed.range.end-parsed.range.start+1>16;
      const lane=heavy?this.heavy:this.ordinary;
      const execute=()=>this.bot.run(command,sender,{...context,signal});
      const work=()=>parsed?.action==='audio'?execute():lane.run(execute,{signal});
      const mutable=['bind','unbind','记录','对比','周报','月报','audio','随机','练习','群榜'];
      const result=await (mutable.includes(parsed?.action)?work():this.cache.get(`${sender}:${this.bindings.get(sender)||''}:${command}`,work));
      checkCancelled(signal);
      await this.history?.capture(result,sender);
      return result;
    },{signal}),this.budget(parsed?.action),context.signal);
  }
}
